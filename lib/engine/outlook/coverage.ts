import type { SupabaseClient } from "@supabase/supabase-js";
import { PBS_NATIONAL_CPI, latestCpiMonth } from "@/lib/market-data/pbs-cpi";
import { policyRateContext } from "@/lib/market-data/macro-assets";
import { findGaps, horizonStats, volConditionalStats, type ClosePoint, type HorizonStat, type VolConditionalStat } from "@/lib/engine/outlook/history-stats";

/**
 * Phase 1 data-coverage report for the PSX Market Outlook.
 *
 * The single source of truth for "what history do we actually hold, how fresh
 * is it, and what is missing" — read by both the CLI audit and the Outlook tab
 * so the two can never drift apart.
 *
 * This module deliberately produces no forecasts. It answers whether a forecast
 * is supportable, which is a prerequisite question and the whole of Phase 1.
 */

export const OUTLOOK_INDEX = "KSE100";

export type SeriesGroup = "index" | "macro" | "breadth" | "flows" | "news";
export type SeriesQuality = "good" | "limited" | "stale" | "missing";

export interface SeriesCoverage {
  key: string;
  label: string;
  group: SeriesGroup;
  granularity: "daily" | "monthly" | "step" | "event";
  rows: number;
  firstDate: string | null;
  lastDate: string | null;
  years: number;
  ageDays: number | null;
  quality: SeriesQuality;
  /** Whether this series has enough history to train on, as opposed to only describing the present. */
  modelReady: boolean;
  note: string;
}

export interface MissingSource {
  key: string;
  label: string;
  why: string;
  obtainable: "no-public-source" | "manual-entry" | "paid-plan" | "accrues-forward";
}

export interface OutlookCoverageReport {
  generatedAt: string;
  /** Longest span every model-ready daily series shares. Bounds any training window. */
  bindingConstraint: { series: string; firstDate: string | null; years: number } | null;
  series: SeriesCoverage[];
  missing: MissingSource[];
  index: {
    ticker: string;
    points: number;
    firstDate: string | null;
    lastDate: string | null;
    years: number;
    gaps: ReturnType<typeof findGaps>;
  } | null;
  horizons: HorizonStat[];
  volConditional: VolConditionalStat[];
}

const DAY_MS = 86_400_000;

function daysSince(date: string | null, asOf: Date): number | null {
  if (!date) return null;
  return Math.floor((asOf.getTime() - Date.parse(date)) / DAY_MS);
}

function yearsBetween(first: string | null, last: string | null): number {
  if (!first || !last) return 0;
  return (Date.parse(last) - Date.parse(first)) / (365.25 * DAY_MS);
}

/**
 * Grade a series. Staleness outranks depth on purpose: a long history that
 * stopped updating is more dangerous than a short one that is current, because
 * it looks healthy in every summary that only reports row counts.
 */
function grade(rows: number, years: number, ageDays: number | null, staleAfterDays: number): SeriesQuality {
  if (rows === 0) return "missing";
  if (ageDays !== null && ageDays > staleAfterDays) return "stale";
  if (years < 2 || rows < 60) return "limited";
  return "good";
}

/** Distinct dates for a table/column, paging past the PostgREST row cap. */
async function datesOf(
  supabase: SupabaseClient,
  table: string,
  column: string,
  filter?: { column: string; value: string }
): Promise<string[]> {
  const PAGE = 1000;
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(column).order(column, { ascending: true }).range(from, from + PAGE - 1);
    if (filter) q = q.eq(filter.column, filter.value);
    const { data, error } = await q;
    if (error) return out;
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const r of rows) {
      const v = r[column];
      if (v) out.push(String(v).slice(0, 10));
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Daily closes for the outlook index, oldest first. */
export async function readIndexHistory(supabase: SupabaseClient, ticker = OUTLOOK_INDEX): Promise<ClosePoint[]> {
  const PAGE = 1000;
  const out: ClosePoint[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("price_date, close")
      .eq("ticker", ticker)
      .order("price_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) {
      const close = Number(r.close);
      if (Number.isFinite(close) && close > 0) out.push({ date: r.price_date as string, close });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

function summarise(
  key: string,
  label: string,
  group: SeriesGroup,
  granularity: SeriesCoverage["granularity"],
  dates: string[],
  asOf: Date,
  staleAfterDays: number,
  note: string,
  modelReadyMinYears = 3
): SeriesCoverage {
  const sorted = [...dates].sort();
  const firstDate = sorted[0] ?? null;
  const lastDate = sorted[sorted.length - 1] ?? null;
  const years = yearsBetween(firstDate, lastDate);
  const ageDays = daysSince(lastDate, asOf);
  const quality = grade(sorted.length, years, ageDays, staleAfterDays);
  // Event-granularity series never count as trainable however far back their
  // timestamps reach. A news archive whose oldest article is from 2017 still
  // has no usable density for 2017: coverage began when ingestion began, and
  // the sentiment attached to old articles was scored under today's prompts,
  // not at the time. Span is not coverage.
  const spanIsCoverage = granularity === "daily" || granularity === "monthly";
  return {
    key,
    label,
    group,
    granularity,
    rows: sorted.length,
    firstDate,
    lastDate,
    years,
    ageDays,
    quality,
    modelReady: spanIsCoverage && years >= modelReadyMinYears && quality !== "missing",
    note,
  };
}

/**
 * Sources we know we do not have. Listed explicitly so the gaps stay visible:
 * an absent series is invisible in any report that only describes what exists,
 * and these absences are what bound the design.
 */
export const MISSING_SOURCES: MissingSource[] = [
  {
    key: "news-archive",
    label: "Historical news and sentiment archive",
    why: "RSS and GDELT expose recent windows only. Sentiment cannot be reconstructed for past regimes, so news can inform the present read but not historical training.",
    obtainable: "no-public-source",
  },
  {
    key: "intraday",
    label: "Intraday price history",
    why: "The PSX intraday endpoint is fetched live but never persisted, so no intraday history exists.",
    obtainable: "accrues-forward",
  },
  {
    key: "political-events",
    label: "Structured political and policy event history",
    why: "No dated, structured record of elections, IMF milestones or political shocks exists in the platform. Would need manual curation.",
    obtainable: "manual-entry",
  },
  {
    key: "external-accounts",
    label: "FX reserves, current account, remittances, M2",
    why: "Tracked only as news query topics, never stored as numeric series. SBP publishes these but no integration exists.",
    obtainable: "manual-entry",
  },
  {
    key: "index-pre-2021",
    label: "Any PSX history before 2021",
    why: "The PSX portal serves a rolling five-year window for every symbol, indices and constituents alike. This is the single binding limit on the whole feature. Yahoo's KSE series is dead (last tick 2019) and stooq is behind a bot challenge, so going deeper needs a paid vendor or a manual archive import.",
    obtainable: "paid-plan",
  },
  {
    key: "intraday-breadth",
    label: "Intraday breadth and value traded before capture began",
    why: "Reconstructed breadth is built from daily closes, so it recovers advance/decline counts but not value traded, most-active names or anything intraday. Those exist only from when live snapshot capture started.",
    obtainable: "accrues-forward",
  },
];

export async function buildOutlookCoverage(
  supabase: SupabaseClient,
  asOf = new Date()
): Promise<OutlookCoverageReport> {
  const series: SeriesCoverage[] = [];

  // --- Index series --------------------------------------------------------
  const indexPoints = await readIndexHistory(supabase, OUTLOOK_INDEX);
  const indexDates = indexPoints.map((p) => p.date);
  series.push(
    summarise(
      OUTLOOK_INDEX,
      "KSE-100 index (daily close)",
      "index",
      "daily",
      indexDates,
      asOf,
      5,
      "Primary modelling series. Depth is capped by the PSX portal's rolling five-year window."
    )
  );

  for (const [ticker, label, note] of [
    ["ALLSHR", "PSX All-Share index", "Broad-market index. Its spread against KSE-100 is a breadth proxy with real history, unlike stored breadth."],
    ["KSE30", "KSE-30 index", "Large-cap subset, useful as a size-tilt cross-check."],
    ["KMI30", "KMI-30 (Shariah) index", "Shariah-screened subset; differs in sector mix from KSE-100."],
  ] as const) {
    series.push(
      summarise(ticker, label, "index", "daily", await datesOf(supabase, "company_price_history", "price_date", { column: "ticker", value: ticker }), asOf, 5, note)
    );
  }

  // --- Macro series --------------------------------------------------------
  for (const [asset, label, note] of [
    ["USDPKR", "USD/PKR exchange rate", "Currency stress input. Deep history from Twelve Data."],
    ["GOLD", "Gold (XAU/USD, PKR-converted)", "Local store-of-value alternative and risk hedge."],
    ["BTC", "Bitcoin (PKR-converted)", "Speculative risk-appetite proxy."],
    ["SPY", "S&P 500 proxy (SPY, USD)", "Developed-market risk appetite. Kept in USD so currency moves do not contaminate the signal."],
    ["EEM", "Emerging markets proxy (EEM, USD)", "Emerging-market risk appetite, the closer global read for PSX."],
    ["TBILL", "PKR policy / T-bill yield", "Hand-maintained step series of SBP policy decisions, not a live feed."],
  ] as const) {
    series.push(
      summarise(asset, label, "macro", asset === "TBILL" ? "step" : "daily", await datesOf(supabase, "macro_asset_history", "asof_date", { column: "asset", value: asset }), asOf, asset === "TBILL" ? 120 : 7, note)
    );
  }

  // --- Hand-maintained macro arrays ---------------------------------------
  // These live in source files rather than the database, so nothing refreshes
  // them and nothing has flagged them when they fall behind. Surfacing their
  // age is the point: silent staleness is the failure mode.
  const cpiMonths = Object.keys(PBS_NATIONAL_CPI).sort();
  const latestCpi = latestCpiMonth();
  const cpiLastDay = `${latestCpi}-28`;
  series.push({
    key: "CPI",
    label: "PBS National CPI (monthly)",
    group: "macro",
    granularity: "monthly",
    rows: cpiMonths.length,
    firstDate: `${cpiMonths[0]}-01`,
    lastDate: cpiLastDay,
    years: yearsBetween(`${cpiMonths[0]}-01`, cpiLastDay),
    ageDays: daysSince(cpiLastDay, asOf),
    quality: grade(cpiMonths.length, yearsBetween(`${cpiMonths[0]}-01`, cpiLastDay), daysSince(cpiLastDay, asOf), 75),
    modelReady: false,
    note: "Hardcoded in lib/market-data/pbs-cpi.ts. Extending it is manual data entry from PBS releases; missing months are never interpolated.",
  });

  const policy = policyRateContext(asOf.toISOString().slice(0, 10));
  series.push({
    key: "POLICY_RATE",
    label: "SBP policy rate path",
    group: "macro",
    granularity: "step",
    rows: 1,
    firstDate: null,
    lastDate: policy.since,
    years: 0,
    ageDays: daysSince(policy.since, asOf),
    quality: "good",
    modelReady: false,
    note: `Currently ${policy.currentPct}% since ${policy.since} (${policy.direction}, peak ${policy.peakPct}%). Hardcoded step series in lib/market-data/macro-assets.ts; a missed MPC decision goes unnoticed without this check.`,
  });

  // --- Short-history operational series -----------------------------------
  series.push(
    summarise(
      "BREADTH",
      "Market breadth (advancers/decliners)",
      "breadth",
      "daily",
      await datesOf(supabase, "market_breadth_history", "trade_date"),
      asOf,
      5,
      "Reconstructed by counting constituent EOD moves, so it reaches back as far as the price panel rather than as far as our own capture history."
    )
  );
  series.push(
    summarise(
      "SNAPSHOTS",
      "Live market snapshots (movers, value traded)",
      "breadth",
      "daily",
      await datesOf(supabase, "market_snapshots", "snapshot_date"),
      asOf,
      5,
      "The as-observed daily capture. Carries fields that cannot be recomputed later, such as most-active ticker and value traded, and only accrues forward."
    )
  );
  series.push(
    summarise(
      "FLOWS",
      "Foreign / local investor flows (FIPI, LIPI)",
      "flows",
      "daily",
      await datesOf(supabase, "foreign_flow_days", "flow_date"),
      asOf,
      10,
      "Backfilled session by session from SCSTrade, whose endpoints accept an arbitrary date. Source figures are attributed to NCCPL."
    )
  );
  series.push(
    summarise(
      "NEWS",
      "Global news articles with sentiment",
      "news",
      "event",
      await datesOf(supabase, "global_news_articles", "published_at"),
      asOf,
      5,
      "Recent windows only. Usable for the current read, not for historical training."
    )
  );

  // --- Derived summary -----------------------------------------------------
  const modelReadyDaily = series.filter((s) => s.modelReady && s.granularity === "daily");
  const binding = modelReadyDaily.length
    ? modelReadyDaily.reduce((worst, s) => (s.years < worst.years ? s : worst))
    : null;

  return {
    generatedAt: asOf.toISOString(),
    bindingConstraint: binding ? { series: binding.label, firstDate: binding.firstDate, years: binding.years } : null,
    series,
    missing: MISSING_SOURCES,
    index: indexPoints.length
      ? {
          ticker: OUTLOOK_INDEX,
          points: indexPoints.length,
          firstDate: indexDates[0],
          lastDate: indexDates[indexDates.length - 1],
          years: yearsBetween(indexDates[0], indexDates[indexDates.length - 1]),
          gaps: findGaps(indexDates),
        }
      : null,
    horizons: indexPoints.length ? horizonStats(indexPoints) : [],
    volConditional: indexPoints.length ? volConditionalStats(indexPoints) : [],
  };
}
