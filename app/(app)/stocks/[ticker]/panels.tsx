import { createClient, getUser } from "@/lib/supabase/server";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { getCompanyFilings } from "@/lib/company/filings";
import { getFundamentals } from "@/lib/company/fundamentals";
import { sectorColor } from "@/lib/shared/sector-colors";
import { computeRatios, type RatioRow } from "@/lib/engine/ratios";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionButton } from "@/components/ui/action-button";
import { FundamentalsGrid } from "@/components/features/stocks/fundamentals-grid";
import { FilingsSpine, type SpineEntry } from "@/components/features/stocks/filings-spine";
import { formatNumber, formatFinancialPeriod, cn } from "@/lib/shared/format";
import {
  FileText,
} from "lucide-react";

/**
 * Neutralise unadjusted corporate actions in a close series, for display.
 *
 * PSX price history is stored raw, so a split lands as a single enormous
 * session: Mari reads 3,536.83 to 415.90 overnight on 16 September 2024, an
 * apparent 88% collapse that never happened. Drawn unadjusted, the chart shows
 * a crash and the shape of five years of trading is destroyed by one artefact.
 *
 * A single-session move beyond 40% is treated as a corporate action rather than
 * a trade — PSX applies daily price limits far tighter than that, so a real
 * move of this size cannot happen in one session. Everything before it is
 * scaled by the ratio, which is the standard back-adjustment.
 *
 * This is a display fix on a data problem. The right answer is a corporate
 * actions table applied at ingest, which is recorded in the pipeline gaps note.
 */
function splitAdjust(closes: number[]): number[] {
  if (closes.length < 2) return closes;
  const out = [...closes];
  for (let i = out.length - 1; i > 0; i--) {
    const ratio = out[i] / out[i - 1];
    if (ratio > 1.4 || ratio < 0.6) {
      for (let j = 0; j < i; j++) out[j] *= ratio;
    }
  }
  return out;
}

const compactShares = (v: number) =>
  new Intl.NumberFormat("en-PK", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/**
 * The business description, trimmed only when it is genuinely long.
 *
 * The old limit was 300 characters, which cut more than half of them: the
 * median PSX description is 316 and OGDC's is 405, so it lost the sentence
 * saying what the company actually does and kept only the one about when it
 * was incorporated. These are short factual profiles and the column has room
 * for them, so the limit is now 700 — past the 90th percentile, leaving 16 of
 * 643 to trim at all.
 *
 * When it does trim, it stops on a sentence boundary and adds no ellipsis: a
 * complete sentence needs no trailing dots, and appending them produced ").…".
 * A mid-word cut still gets one, because there the reader should know.
 */
const DESCRIPTION_LIMIT = 700;

function shortDescription(description: string | null): string | null {
  if (!description) return null;
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (cleaned.length <= DESCRIPTION_LIMIT) return cleaned;

  const sentences = cleaned.match(new RegExp(`^.{40,${DESCRIPTION_LIMIT}}[.!?](?=\\s|$)`))?.[0]?.trim();
  if (sentences) return sentences;

  const slice = cleaned.slice(0, DESCRIPTION_LIMIT - 10);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 80 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}


/**
 * Whether a stored profile came from the exchange's own company page.
 *
 * Judged on the source URL, not the source label. The label is unreliable:
 * identity.ts stamps "stock-universe" over it whenever it fills in a name or
 * sector, so genuine PSX prose for OGDC, Mari, UBL, MCB, Hub Power and others
 * was being suppressed and their Overview read "no description on file" while
 * the description sat in the row. The URL records where the text actually came
 * from and nothing overwrites it.
 */
function isOfficialPsxProfileSource(source: string | null | undefined, sourceUrl?: string | null): boolean {
  if (sourceUrl && /dps\.psx\.com\.pk\/company\//i.test(sourceUrl)) return true;
  return source === "psx-company-page" || source === "psx-portal";
}

function ratioByName(rows: RatioRow[], name: string): RatioRow | null {
  return rows.find((r) => r.ratio_name === name) ?? null;
}

// ---------------------------------------------------------------------------
// 1. Overview
// ---------------------------------------------------------------------------

export async function OverviewPanel({
  ticker,
}: {
  ticker: string;
  companyEnrichmentEnabled?: boolean;
  readOnly?: boolean;
}) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [metadata, technicals, ratios, fundamentals] = await Promise.all([
    getCompanyMetadata(supabase, ticker),
    getTechnicals(supabase, ticker),
    computeRatios(supabase, ticker),
    getFundamentals(supabase, ticker),
  ]);

  // Only the official PSX profile is quoted as the business description. An
  // inferred summary would read as fact in the one place on the page that is
  // prose rather than a figure.
  const officialDescription = isOfficialPsxProfileSource(metadata.meta.source, metadata.meta.sourceUrl)
    ? metadata.description
    : null;
  const summary = shortDescription(officialDescription);

  const peRow = ratioByName(ratios, "P/E");
  const pe = peRow?.ratio_value ?? null;
  const divYield = ratioByName(ratios, "Dividend yield (TTM)")?.ratio_value ?? null;
  const sectorPe = fundamentals.sectorPe;

  const price = technicals.latestPrice ?? null;
  const high52 = technicals.fiftyTwoWeekHigh ?? null;
  const fromHigh = price !== null && high52 ? ((price - high52) / high52) * 100 : null;

  const closes = (technicals.history ?? []).map((c) => Number(c.close)).filter((c) => Number.isFinite(c) && c > 0);
  const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;

  const signals: { label: string; sub: string; value: string }[] = [];

  signals.push({
    label: "Valuation against the sector",
    sub: peRow?.source_period ? `P/E, ${formatFinancialPeriod(peRow.source_period)}` : "P/E",
    value:
      pe === null
        ? // The engine withholds a multiple on a loss and says why; that reason
          // belongs here rather than a bare dash.
            peRow?.missing?.startsWith("Loss-making")
            ? "No multiple — loss-making period"
            : "Not enough filed data"
        : sectorPe.median !== null
          ? `${pe.toFixed(1)}x against ${sectorPe.median.toFixed(1)}x`
          : `${pe.toFixed(1)}x · only ${sectorPe.contributors} peer${sectorPe.contributors === 1 ? "" : "s"} priced`,
  });

  signals.push({
    label: "Distance from the 52-week high",
    sub: high52 !== null ? `high ${formatNumber(high52)}` : "no 52-week high on file",
    value: fromHigh === null ? "—" : `${fromHigh >= 0 ? "+" : "−"}${Math.abs(fromHigh).toFixed(1)}%`,
  });

  signals.push({
    label: "Momentum",
    sub: ma50 !== null ? `50-session ${formatNumber(ma50)}` : "fewer than 50 sessions on file",
    value:
      ma50 === null || price === null
        ? "Not enough sessions"
        : price >= ma50
          ? "Above the 50-session average"
          : "Below the 50-session average",
  });

  signals.push({
    label: "Payout",
    sub: "trailing twelve months",
    value: divYield === null ? "No verified dividend per share" : `${divYield.toFixed(2)}% on the current price`,
  });

  return (
    <div>
      <p className="eyebrow">The business</p>
      <p className="mt-3 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        {summary ??
          `No description on file. PSX company data carries no business summary for ${ticker} yet, so nothing is shown rather than inferred.`}
      </p>

      <div className="mt-8">
        <p className="border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
          Key signals
        </p>
        {signals.map((s) => (
          <div key={s.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-5 border-b border-rule py-3">
            <span>
              <span className="block text-sm text-text-strong">{s.label}</span>
              <span className="figure mt-0.5 block text-(length:--text-2xs) text-text-faint">{s.sub}</span>
            </span>
            <span className="figure text-right text-sm font-semibold text-text-strong">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Financials
// ---------------------------------------------------------------------------

interface FinancialRow {
  ticker: string;
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  data: Record<string, number | null | string>;
  reported_date: string | null;
  source_type: string | null;
  source_url: string | null;
  reporting_basis: string | null;
  review_status: string | null;
  confidence: number | null;
  updated_at: string | null;
}

function FetchFinancialsButton({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  if (readOnly) return null;
  return (
    <ActionButton
      endpoint={`/api/stocks/${ticker}/refresh`}
      body={{ section: "financials" }}
      label={<><FileText className="h-3.5 w-3.5" /> Refresh financials</>}
      variant="outline"
      size="sm"
    />
  );
}

/**
 * Fundamentals: the six metrics as small multiples over their filed years.
 *
 * The old statement browser is gone. The design asks for a reading of how the
 * business earns, against its own history and its sector, rather than a table
 * of every line item ever extracted.
 */
export async function FinancialsPanel({ ticker, readOnly = false }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();
  const [{ data }, { data: lastLog }, fundamentals, { data: master }] = await Promise.all([
    supabase
      .from("company_financials")
      .select("ticker, period_type, fiscal_year, fiscal_period, statement_type, data, reported_date, source_type, source_url, reporting_basis, review_status, confidence, updated_at")
      .eq("ticker", ticker)
      .eq("review_status", "published")
      .order("reported_date", { ascending: false })
      .limit(120),
    supabase
      .from("data_fetch_logs")
      .select("status, detail, created_at, source")
      .eq("ticker", ticker)
      .eq("section", "financials")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getFundamentals(supabase, ticker),
    supabase.from("stock_master").select("sector").eq("ticker", ticker).maybeSingle(),
  ]);

  const rows = (data ?? []) as FinancialRow[];

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={FileText}
          title="Financial data is not populated yet"
          description={
            lastLog
              ? `Last fetch attempt: ${String(lastLog.created_at).slice(0, 16).replace("T", " ")} via ${lastLog.source} — ${lastLog.status}${lastLog.detail ? ` (${lastLog.detail})` : ""}. The engine reads the official PSX company page; numbers are echoed from PSX, never invented.`
              : `No data has been loaded for ${ticker} yet. The engine reads the official PSX company page (sales, EPS, margins) — numbers are echoed from PSX, never invented.`
          }
          action={<FetchFinancialsButton ticker={ticker} readOnly={readOnly} />}
        />
      </div>
    );
  }

  // Only promise the median hairline when at least one cell actually draws one;
  // sectors with too few filers show none.
  const hasAnyMedian = Object.values(fundamentals.series).some((v) => v.sectorMedian !== null);

  return (
    <div>
      <p className="eyebrow">Filed years</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        How the business earns
      </h2>
      <p className="mt-1 mb-7 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        The shaded band is this company&apos;s own filed range{hasAnyMedian ? ", and the dashed hairline is the sector median" : ""}.
        Select a chart to read the years and the sector ranking.
      </p>
      <FundamentalsGrid data={fundamentals} hue={sectorColor(master?.sector)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Earnings
// ---------------------------------------------------------------------------

/**
 * Earnings: reported EPS by quarter, against the same quarter a year earlier.
 *
 * The design draws this as reported-against-expected, with surprise bars. We
 * have no expected figure — PSX publishes no consensus and we source none, and
 * the handoff's own surprises were generated for the demo. Rather than invent
 * an estimate to subtract from, the bars compare each quarter with the same
 * quarter of the prior year, which is the comparison a PSX reader makes anyway
 * and needs no data we do not hold. The shape is the design's; the baseline is
 * honest.
 */
export async function EarningsPanel({ ticker }: { ticker: string; readOnly?: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_financials")
    .select("fiscal_year, fiscal_period, data, updated_at")
    .eq("ticker", ticker)
    .eq("period_type", "quarterly")
    .eq("review_status", "published")
    .order("fiscal_year", { ascending: true })
    .limit(60);

  // One row per fiscal quarter, newest extraction winning, same rule as the
  // annual merge: a company can hold two extractions that disagree.
  const byQuarter = new Map<string, { year: number; period: string; eps: number }>();
  for (const r of [...(data ?? [])].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)))) {
    const eps = (r.data as Record<string, unknown> | null)?.eps;
    if (typeof eps !== "number" || !Number.isFinite(eps)) continue;
    if (!r.fiscal_period) continue;
    byQuarter.set(`${r.fiscal_year}-${r.fiscal_period}`, { year: r.fiscal_year, period: r.fiscal_period, eps });
  }

  const quarters = [...byQuarter.values()]
    .sort((a, b) => a.year - b.year || a.period.localeCompare(b.period))
    .slice(-8);

  if (quarters.length === 0) {
    return (
      <div>
        <p className="eyebrow">Quarterly earnings</p>
        <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
          Reported against the year before
        </h2>
        <p className="mt-4 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No quarterly accounts have been extracted for {ticker} yet. They appear here as the filings are read.
        </p>
      </div>
    );
  }

  const rows = quarters.map((q) => {
    const prior = byQuarter.get(`${q.year - 1}-${q.period}`) ?? null;
    const change = prior && prior.eps !== 0 ? ((q.eps - prior.eps) / Math.abs(prior.eps)) * 100 : null;
    return { ...q, prior: prior?.eps ?? null, change };
  });

  const withChange = rows.filter((r) => r.change !== null);
  const maxAbs = Math.max(1, ...withChange.map((r) => Math.abs(r.change as number)));

  return (
    <div>
      <p className="eyebrow">Quarterly earnings</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        Reported against the year before
      </h2>
      <p className="mb-8 mt-1 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        Each quarter&apos;s reported earnings per share against the same quarter a year earlier, which controls for
        the seasonality most PSX businesses carry. No analyst estimate is involved — none is published for this
        market.
      </p>

      {/*
        The bars only earn their space once there are a few of them to compare.
        With one or two year-on-year pairs the chart is mostly empty slots
        labelled "no prior year", which reads as broken rather than sparse — the
        ledger below says the same thing without the holes.
      */}
      {withChange.length >= 3 && (
        <div className="flex items-end gap-3 overflow-x-auto pb-1" style={{ minHeight: "11rem" }}>
          {rows.map((r) => {
            const pct = r.change;
            const h = pct === null ? 0 : Math.max(4, (Math.abs(pct) / maxAbs) * 96);
            const up = (pct ?? 0) >= 0;
            return (
              <div key={`${r.year}-${r.period}`} className="flex min-w-[5.5rem] flex-1 flex-col items-stretch">
                <div className="flex h-24 items-end">
                  {pct !== null && (
                    <span className={cn("block w-full", up ? "bg-up" : "bg-down")} style={{ height: `${h}px` }} />
                  )}
                </div>
                <span className={cn("figure mt-2 block text-center text-(length:--text-2xs) font-semibold", pct === null ? "text-text-faint" : up ? "text-up" : "text-down")}>
                  {pct === null ? "no prior year" : `${up ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}
                </span>
                <span className="figure mt-0.5 block text-center text-(length:--text-2xs) text-text-faint">
                  {r.period} FY{r.year}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-9 overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] gap-4 border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
            <span>Quarter</span>
            <span className="text-right">Reported EPS</span>
            <span className="text-right">Year before</span>
            <span className="text-right">Change</span>
          </div>
          {[...rows].reverse().map((r) => (
            <div key={`row-${r.year}-${r.period}`} className="grid grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] items-baseline gap-4 border-b border-rule py-2.5">
              <span className="figure text-sm text-text-strong">{r.period} FY{r.year}</span>
              <span className="figure text-right text-sm font-semibold text-text-strong">{formatNumber(r.eps)}</span>
              <span className="figure text-right text-sm text-text-muted">{r.prior === null ? "—" : formatNumber(r.prior)}</span>
              <span className={cn("figure text-right text-sm font-semibold", r.change === null ? "text-text-faint" : r.change >= 0 ? "text-up" : "text-down")}>
                {r.change === null ? "—" : `${r.change >= 0 ? "+" : "−"}${Math.abs(r.change).toFixed(1)}%`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Technicals
// ---------------------------------------------------------------------------

/**
 * Technicals: price structure, placed after the fundamental tabs on purpose.
 *
 * The design's own heading says it — for timing, not for forming the view. The
 * chart is here to answer "is this a reasonable moment to add", not to make the
 * case for owning the company, which is what the tabs above it are for.
 */
export async function TechnicalsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const [technicals, { data: master }] = await Promise.all([
    getTechnicals(supabase, ticker),
    supabase.from("stock_master").select("sector").eq("ticker", ticker).maybeSingle(),
  ]);
  const hue = sectorColor(master?.sector);

  if (technicals.history.length === 0) {
    return (
      <div>
        <p className="eyebrow">Price structure</p>
        <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
          For timing, not for forming the view
        </h2>
        <p className="mt-4 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          The exchange returned no daily history for {ticker}. That is normal for a newly listed, suspended or
          illiquid counter.
        </p>
      </div>
    );
  }

  const closes = splitAdjust(
    technicals.history.map((c) => Number(c.close)).filter((c) => Number.isFinite(c) && c > 0)
  );
  const price = technicals.latestPrice;
  const low52 = technicals.fiftyTwoWeekLow;
  const high52 = technicals.fiftyTwoWeekHigh;
  const hasRange = low52 !== null && high52 !== null && high52 > low52;
  const pos = hasRange && price !== null ? Math.min(100, Math.max(0, ((price - low52) / (high52 - low52)) * 100)) : null;

  const fmt = (v: number | null, digits = 2) => (v === null ? "—" : formatNumber(v, digits));
  const indicators: { label: string; value: string; tone?: "up" | "down" }[] = [
    { label: "20-session average", value: fmt(technicals.ma20), tone: price !== null && technicals.ma20 !== null ? (price >= technicals.ma20 ? "up" : "down") : undefined },
    { label: "50-session average", value: fmt(technicals.ma50), tone: price !== null && technicals.ma50 !== null ? (price >= technicals.ma50 ? "up" : "down") : undefined },
    { label: "100-session average", value: fmt(technicals.ma100), tone: price !== null && technicals.ma100 !== null ? (price >= technicals.ma100 ? "up" : "down") : undefined },
    { label: "200-session average", value: fmt(technicals.ma200), tone: price !== null && technicals.ma200 !== null ? (price >= technicals.ma200 ? "up" : "down") : undefined },
    { label: "RSI, 14 sessions", value: technicals.rsi === null ? "—" : technicals.rsi.toFixed(0) },
    { label: "Annualised volatility", value: technicals.volatility === null ? "—" : `${technicals.volatility.toFixed(1)}%` },
    { label: "Average volume, 30 sessions", value: technicals.averageVolume === null ? "—" : compactShares(technicals.averageVolume) },
  ];

  // Stated in words, so the reader is not left to compare four averages to a
  // price themselves. Only claims what the numbers actually support.
  const chips: string[] = [];
  if (price !== null && technicals.ma20 !== null && technicals.ma50 !== null) {
    const above = [technicals.ma20, technicals.ma50].filter((m) => price >= m).length;
    chips.push(
      above === 2 ? "Above the 20 and 50-session averages"
        : above === 0 ? "Below the 20 and 50-session averages"
          : "Between the 20 and 50-session averages"
    );
  }
  if (technicals.volume !== null && technicals.averageVolume) {
    chips.push(
      technicals.volume >= technicals.averageVolume
        ? "Volume above its 30-session average"
        : "Volume below its 30-session average"
    );
  }

  const W = 620, H = 240;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const span = hi - lo || 1;
  const x = (i: number) => (i / Math.max(1, closes.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * H;
  const line = `M${closes.map((c, i) => `${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(" L")}`;

  return (
    <div>
      <p className="eyebrow">Price structure</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        For timing, not for forming the view
      </h2>

      <div className="mt-7 grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" className="block overflow-visible" aria-hidden="true">
            <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={hue} fillOpacity="0.08" />
            <path d={line} fill="none" stroke={hue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {hasRange && (
            <div className="mt-6">
              <div className="flex items-baseline justify-between text-(length:--text-2xs) text-text-faint">
                <span className="figure">{formatNumber(low52)}</span>
                <span className="font-bold uppercase tracking-(--tracking-caps)">52-week range</span>
                <span className="figure">{formatNumber(high52)}</span>
              </div>
              <div className="relative mt-2 h-1.5 bg-surface-inset">
                <span className="absolute -top-1 bottom-[-0.25rem] w-0.5 bg-ink-1" style={{ left: `${pos}%` }} />
              </div>
            </div>
          )}

          {chips.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {chips.map((c) => (
                <span key={c} className="rounded-(--radius-pill) border border-rule px-3.5 py-1.5 text-(length:--text-2xs) text-text-muted">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
            Indicators
          </p>
          {indicators.map((ind) => (
            <div key={ind.label} className="flex items-baseline justify-between gap-5 border-b border-rule py-2.5">
              <span className="text-sm text-text-muted">{ind.label}</span>
              <span className={cn("figure text-sm font-semibold", ind.tone === "up" ? "text-up" : ind.tone === "down" ? "text-down" : "text-text-strong")}>
                {ind.value}
              </span>
            </div>
          ))}
          <p className="mt-3.5 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
            A green figure means the last price sits above that average, not that the share is a buy. Averages
            describe where the price has been.
          </p>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// 6. Dividends
// ---------------------------------------------------------------------------

/**
 * Dividends: what the company declared.
 *
 * Reads the announcement feed, not the user's own dividend receipts — the
 * design is explicit that this is the company's record and that what you were
 * actually paid is reconciled on the Dividends page. The two disagree often
 * enough (timing, withholding, partial holdings) that showing receipts here
 * would quietly answer a different question than the one asked.
 *
 * PSX publishes a book-closure window rather than an ex-date, and no pay date
 * at all, so those columns say what they are instead of borrowing the names of
 * fields we do not have.
 */
export async function DividendsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("company_payouts")
    .select("kind, term, percentage, dividend_per_share, announcement_date, book_closure_start, book_closure_end")
    .eq("ticker", ticker)
    .order("announcement_date", { ascending: false })
    .limit(40);
  const rows = data ?? [];

  return (
    <div>
      <p className="eyebrow">Announced payouts</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        What the company declared
      </h2>

      {rows.length === 0 ? (
        <p className="mt-6 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No payout announcements on file for {ticker}. They appear here as the exchange publishes them.
        </p>
      ) : (
        <>
          <div className="mt-7 overflow-x-auto">
            <div className="min-w-[38rem]">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)_9rem_7rem_6rem] gap-4 border-b border-rule-strong pb-2 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
                <span>Announced</span>
                <span>Kind</span>
                <span>Book closure</span>
                <span className="text-right">Per share</span>
                <span className="text-right">Of face</span>
              </div>
              {rows.map((r, i) => (
                <div
                  key={`${r.announcement_date}-${i}`}
                  className="grid grid-cols-[7rem_minmax(0,1fr)_9rem_7rem_6rem] items-baseline gap-4 border-b border-rule py-3"
                >
                  <span className="figure text-sm text-text-strong">{r.announcement_date ?? "—"}</span>
                  <span className="text-sm text-text-muted">
                    {[r.term, r.kind].filter(Boolean).join(" ") || "cash"}
                  </span>
                  <span className="figure text-sm text-text-muted">
                    {r.book_closure_start
                      ? r.book_closure_end && r.book_closure_end !== r.book_closure_start
                        ? `${r.book_closure_start} to ${r.book_closure_end}`
                        : r.book_closure_start
                      : "—"}
                  </span>
                  <span className="figure text-right text-sm font-semibold text-text-strong">
                    {typeof r.dividend_per_share === "number" ? formatNumber(r.dividend_per_share) : "—"}
                  </span>
                  <span className="figure text-right text-sm text-text-muted">
                    {typeof r.percentage === "number" ? `${formatNumber(r.percentage, 0)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-5 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
            Company announcements, not your receipts. Dividends you were actually paid are reconciled on the
            Dividends page. PSX publishes a book-closure window rather than an ex-date, and does not publish a
            pay date.
          </p>
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// 7. News & Filings
// ---------------------------------------------------------------------------

/**
 * Filings and news on one dated spine.
 *
 * The "one figure it moved" line is only drawn where it can be established from
 * our own records: a dividend announcement is matched to the payout row that
 * carries its per-share figure. A board meeting called to approve accounts is
 * known to have moved nothing yet, so it says that. Anything else says nothing,
 * because a line claiming to name the figure that moved is worthless the moment
 * it starts guessing.
 */
export async function NewsFilingsPanel({ ticker }: { ticker: string }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [filings, newsRes, payoutsRes] = await Promise.all([
    getCompanyFilings(ticker, 30),
    supabase
      .from("news_articles")
      .select("title, url, source, published_at")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .eq("ignored", false)
      .order("published_at", { ascending: false })
      .limit(15),
    supabase
      .from("company_payouts")
      .select("dividend_per_share, kind, term, announcement_date")
      .eq("ticker", ticker)
      .limit(60),
  ]);

  const payouts = payoutsRes.data ?? [];

  /**
   * The payout this filing announced, when that can be established without
   * guessing.
   *
   * The two dates are not the same event: PSX dates the notice, while the
   * payout row carries the board's decision date, and they sit anywhere from a
   * few days to three weeks apart — Mari 11 days, OGDC 23. A tight window
   * matched almost nothing. So the nearest payout within a month wins, but only
   * if it is the only candidate in that month; two payouts in range means the
   * filing cannot be attributed to one of them, and nothing is claimed.
   */
  const WINDOW_DAYS = 32;
  function payoutNear(date: string | null) {
    if (!date) return null;
    const t = Date.parse(date);
    if (!Number.isFinite(t)) return null;
    const inRange = payouts
      .filter((p) => p.announcement_date && typeof p.dividend_per_share === "number")
      .map((p) => ({ p, gap: Math.abs(Date.parse(p.announcement_date as string) - t) / 86400000 }))
      .filter((x) => x.gap <= WINDOW_DAYS)
      .sort((a, b) => a.gap - b.gap);
    if (inRange.length !== 1) return null;
    return inRange[0].p;
  }

  const entries: SpineEntry[] = [
    ...filings.map((f) => {
      const payout = f.category === "dividend" ? payoutNear(f.date) : null;
      return {
        date: f.date,
        title: f.title,
        category: f.category,
        url: f.url,
        source: "PSX announcement",
        moved: payout
          ? `Dividend per share ${(payout.dividend_per_share as number).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${payout.term ? ` · ${payout.term}` : ""}`
          : null,
        pending:
          f.category === "board_meeting" ? "Nothing filed yet. The figure arrives with the accounts." : null,
      };
    }),
    ...(newsRes.data ?? []).map((n) => ({
      date: (n.published_at as string | null)?.slice(0, 10) ?? null,
      title: n.title as string,
      category: "news",
      url: (n.url as string | null) ?? null,
      source: (n.source as string | null) ?? "Press",
      moved: null,
      pending: null,
    })),
  ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <div>
      <p className="eyebrow">Primary sources</p>
      <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
        Everything filed or reported
      </h2>
      <p className="mb-7 mt-1 max-w-(--measure) text-sm leading-relaxed text-text-muted">
        In date order, newest first. Where an entry moved a figure we hold, it names it, so an accounting event
        reads differently from an announcement that changed nothing.
      </p>

      {entries.length === 0 ? (
        <p className="max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No filings or coverage on file for {ticker}. Announcements appear here as the exchange publishes them.
        </p>
      ) : (
        <FilingsSpine entries={entries} />
      )}
    </div>
  );
}
