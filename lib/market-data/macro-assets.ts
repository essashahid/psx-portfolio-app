import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Multi-asset history for the capital-allocation forecaster: Bitcoin, gold,
 * USD/PKR and a PKR T-bill yield. PSX equity history is handled separately by
 * eod-cache.ts / psx-dps.ts. Gold, BTC and USD/PKR come from Twelve Data (the
 * provider this project already integrates for PSX fallback prices); the result
 * is converted to PKR where meaningful and cached in macro_asset_history.
 *
 * Honesty rules (see the allocation engine): we never synthesise or backfill
 * observations we do not have. When the provider is unconfigured or a symbol is
 * unavailable, the series comes back empty and assessDataQuality() grades it
 * "missing" so the forecaster down-weights or omits it rather than guessing.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const TD_BASE = "https://api.twelvedata.com";
const TD_SOURCE = "twelve-data";

/** Spacing between Twelve Data calls, to stay inside the free-tier rate limit. */
const TD_REQUEST_SPACING_MS = 8_000;

function pause(ms = TD_REQUEST_SPACING_MS): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type MacroAsset = "BTC" | "GOLD" | "USDPKR" | "TBILL" | "SPY" | "EEM" | "BNO";

/**
 * Global risk proxies for the market-outlook work: SPY tracks developed-market
 * (S&P 500) risk appetite, EEM tracks emerging-market risk appetite, which is
 * the closer read for PSX. Both are ETFs rather than the underlying indices
 * because Twelve Data gates raw index symbols (SPX) behind a paid plan while
 * serving the ETFs on the current one; the ETF tracks the index closely enough
 * for a risk-regime signal.
 *
 * These stay in USD (close_native). Converting them to PKR would fold currency
 * moves into what is meant to be a pure global-risk read.
 */
export const GLOBAL_RISK_ASSETS = ["SPY", "EEM"] as const;

export interface MacroPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface MacroAssetRow {
  asset: MacroAsset;
  asof_date: string;
  close_native: number;
  close_pkr: number | null;
  source: string;
}

/**
 * Resolve the Twelve Data key. The shared adapter reads TWELVE_DATA_API_KEY /
 * MARKET_DATA_API_KEY; some installs store it as TWELVE_DATA_API, so accept all
 * three spellings here.
 */
function twelveDataKey(): string | undefined {
  return (
    process.env.TWELVE_DATA_API_KEY ||
    process.env.MARKET_DATA_API_KEY ||
    process.env.TWELVE_DATA_API ||
    undefined
  );
}

export function macroAssetsConfigured(): boolean {
  return !!twelveDataKey();
}

interface TdSeriesResponse {
  status?: string;
  message?: string;
  values?: { datetime?: string; close?: string }[];
}

/** Daily close history for a Twelve Data symbol, oldest first. */
async function fetchTwelveDataDaily(symbol: string): Promise<MacroPoint[]> {
  const key = twelveDataKey();
  if (!key) return [];
  const url = new URL("/time_series", TD_BASE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "5000");
  url.searchParams.set("apikey", key);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as TdSeriesResponse;
    if (json.status === "error" || !Array.isArray(json.values)) return [];
    return json.values
      .map((row) => ({ date: (row.datetime ?? "").slice(0, 10), value: Number(row.close) }))
      .filter((p) => p.date && Number.isFinite(p.value) && p.value > 0)
      .sort(byDateAsc);
  } catch {
    return [];
  }
}

/** Daily BTC/USD close history, oldest first. */
export function fetchBtcUsdHistory(): Promise<MacroPoint[]> {
  return fetchTwelveDataDaily("BTC/USD");
}

/** Daily gold (XAU/USD) close history, oldest first. */
export function fetchGoldUsdHistory(): Promise<MacroPoint[]> {
  return fetchTwelveDataDaily("XAU/USD");
}

/** Daily USD/PKR rate history, oldest first. */
export function fetchUsdPkrHistory(): Promise<MacroPoint[]> {
  return fetchTwelveDataDaily("USD/PKR");
}

/** Daily S&P 500 proxy (SPY) close history in USD, oldest first. */
export function fetchSpyHistory(): Promise<MacroPoint[]> {
  return fetchTwelveDataDaily("SPY");
}

/** Daily emerging-market proxy (EEM) close history in USD, oldest first. */
export function fetchEemHistory(): Promise<MacroPoint[]> {
  return fetchTwelveDataDaily("EEM");
}

/**
 * Daily Brent crude proxy (BNO, the US Brent Oil ETF) in USD, oldest first.
 * An ETF rather than the future for the same reason as SPY/EEM: Twelve Data
 * serves it on the current plan, and it tracks the price closely enough for an
 * oil-shock signal. Pakistan imports its energy, so Brent is the single
 * commodity with a first-order macro link.
 */
export function fetchBnoHistory(): Promise<MacroPoint[]> {
  return fetchTwelveDataDaily("BNO");
}

// --- T-bill / policy yield (admin-editable step series) -------------------
//
// v1 has no reliable free PKR T-bill auction feed, so the short-rate path is a
// small, explicit step series of policy-rate change points (edit here, or wire
// a real feed later). Modelled as an annualised PKR yield with ~zero price
// volatility. Sourced from SBP policy decisions.
const TBILL_YIELD_STEPS: { from: string; yieldPct: number }[] = [
  { from: "2021-01-01", yieldPct: 7.0 },
  { from: "2022-01-01", yieldPct: 10.0 },
  { from: "2022-07-01", yieldPct: 15.0 },
  { from: "2023-01-01", yieldPct: 17.0 },
  { from: "2023-06-26", yieldPct: 22.0 },
  { from: "2024-06-10", yieldPct: 20.5 },
  { from: "2024-09-12", yieldPct: 17.5 },
  { from: "2024-11-04", yieldPct: 15.0 },
  { from: "2024-12-16", yieldPct: 13.0 },
  { from: "2025-01-27", yieldPct: 12.0 },
  { from: "2025-05-05", yieldPct: 11.0 },
  { from: "2025-12-16", yieldPct: 10.5 }, // 50bps cut, MPC 15 Dec 2025
  { from: "2026-04-27", yieldPct: 11.5 }, // surprise 100bps hike; held at 11.5% on 15 Jun 2026
];

export const TBILL_SOURCE = "sbp-policy-steps";

/** Annualised PKR T-bill/policy yield (%) in effect on a given date. */
export function tbillYieldOn(date: string): number {
  let current = TBILL_YIELD_STEPS[0].yieldPct;
  for (const step of TBILL_YIELD_STEPS) {
    if (date >= step.from) current = step.yieldPct;
    else break;
  }
  return current;
}

export interface PolicyRateContext {
  /** Annualised PKR policy/T-bill yield (%) in effect on the given date. */
  currentPct: number;
  /** Effective-from date of the current level. */
  since: string;
  /** Highest level seen at or before the given date. */
  peakPct: number;
  peakDate: string;
  /** The prior distinct level, so callers can describe the last move. */
  previousPct: number | null;
  direction: "rising" | "falling" | "flat";
}

/**
 * The SBP policy-rate path (T-bill proxy) as of a date: the current level, the
 * cycle peak, and the direction of the last move. Lets the Copilot say "rates
 * at 11%, down from a 22% peak" without recomputing anything.
 */
export function policyRateContext(date: string): PolicyRateContext {
  const effective = TBILL_YIELD_STEPS.filter((s) => date >= s.from);
  const steps = effective.length ? effective : [TBILL_YIELD_STEPS[0]];
  const current = steps[steps.length - 1];
  const previous = steps.length >= 2 ? steps[steps.length - 2] : null;
  let peak = steps[0];
  for (const s of steps) if (s.yieldPct > peak.yieldPct) peak = s;
  const direction: PolicyRateContext["direction"] = previous
    ? current.yieldPct > previous.yieldPct
      ? "rising"
      : current.yieldPct < previous.yieldPct
        ? "falling"
        : "flat"
    : "flat";
  return {
    currentPct: current.yieldPct,
    since: current.from,
    peakPct: peak.yieldPct,
    peakDate: peak.from,
    previousPct: previous?.yieldPct ?? null,
    direction,
  };
}

/** Build a monthly T-bill yield series spanning the requested date range. */
export function buildTbillSeries(startDate: string, endDate: string): MacroPoint[] {
  const out: MacroPoint[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (d <= end) {
    const date = d.toISOString().slice(0, 10);
    out.push({ date, value: tbillYieldOn(date) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  // Always carry a point at the exact end date so the synthetic series tracks
  // the latest known short rate and never reads as stale against daily assets.
  if (out.length === 0 || out[out.length - 1].date !== endDate) {
    out.push({ date: endDate, value: tbillYieldOn(endDate) });
  }
  return out;
}

// --- PKR conversion + assembly --------------------------------------------

function byDateAsc(a: MacroPoint, b: MacroPoint): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

/**
 * Build a forward-fill lookup of USD/PKR so a USD-priced asset on any date can
 * be converted using the most recent known rate at or before that date.
 */
function forwardFillLookup(series: MacroPoint[]): (date: string) => number | null {
  const sorted = [...series].sort(byDateAsc);
  return (date: string) => {
    let rate: number | null = null;
    for (const p of sorted) {
      if (p.date <= date) rate = p.value;
      else break;
    }
    return rate;
  };
}

/**
 * Fetch every macro asset, convert BTC and gold to PKR using USD/PKR, and
 * return rows ready to upsert into macro_asset_history. T-bill rows span the
 * union date range so the short-rate path always covers the other assets.
 */
export async function buildMacroAssetRows(): Promise<{
  rows: MacroAssetRow[];
  fetched: Record<MacroAsset, number>;
}> {
  // Fetched one at a time with a pause between calls. Twelve Data's free tier
  // allows only a handful of requests per minute, and firing all five at once
  // reliably drops the last symbols in the batch (they come back empty, which
  // assessDataQuality then grades "missing" — a silent data loss rather than a
  // visible error). Sequential + spaced trades a slower refresh for complete data.
  const btc = await fetchBtcUsdHistory();
  await pause();
  const gold = await fetchGoldUsdHistory();
  await pause();
  const usdpkr = await fetchUsdPkrHistory();
  await pause();
  const spy = await fetchSpyHistory();
  await pause();
  const eem = await fetchEemHistory();
  await pause();
  const bno = await fetchBnoHistory();

  const fxAt = forwardFillLookup(usdpkr);
  const rows: MacroAssetRow[] = [];

  for (const p of usdpkr) {
    rows.push({ asset: "USDPKR", asof_date: p.date, close_native: p.value, close_pkr: null, source: TD_SOURCE });
  }
  // Global risk proxies stay in USD on purpose (see GLOBAL_RISK_ASSETS).
  for (const p of spy) {
    rows.push({ asset: "SPY", asof_date: p.date, close_native: p.value, close_pkr: null, source: TD_SOURCE });
  }
  for (const p of eem) {
    rows.push({ asset: "EEM", asof_date: p.date, close_native: p.value, close_pkr: null, source: TD_SOURCE });
  }
  for (const p of bno) {
    rows.push({ asset: "BNO", asof_date: p.date, close_native: p.value, close_pkr: null, source: TD_SOURCE });
  }
  for (const p of btc) {
    const fx = fxAt(p.date);
    rows.push({
      asset: "BTC",
      asof_date: p.date,
      close_native: p.value,
      close_pkr: fx !== null ? p.value * fx : null,
      source: TD_SOURCE,
    });
  }
  for (const p of gold) {
    const fx = fxAt(p.date);
    rows.push({
      asset: "GOLD",
      asof_date: p.date,
      close_native: p.value,
      close_pkr: fx !== null ? p.value * fx : null,
      source: TD_SOURCE,
    });
  }

  // T-bill series spans the fetched PKR-relevant assets only. The global risk
  // proxies reach back ~20 years, far beyond the first policy step we actually
  // know (TBILL_YIELD_STEPS starts 2021-01-01); spanning them would make
  // tbillYieldOn() carry the earliest known rate backwards for a decade and
  // invent a policy path that never happened. Clamping to the first known step
  // keeps the rule that we never synthesise observations we do not have.
  const pkrDates = rows
    .filter((r) => r.asset === "USDPKR" || r.asset === "BTC" || r.asset === "GOLD")
    .map((r) => r.asof_date)
    .sort();
  if (pkrDates.length > 0) {
    const firstKnownStep = TBILL_YIELD_STEPS[0].from;
    const start = pkrDates[0] > firstKnownStep ? pkrDates[0] : firstKnownStep;
    const end = pkrDates[pkrDates.length - 1];
    if (start <= end) {
      const tbill = buildTbillSeries(start, end);
      for (const p of tbill) {
        rows.push({ asset: "TBILL", asof_date: p.date, close_native: p.value, close_pkr: null, source: TBILL_SOURCE });
      }
    }
  }

  return {
    rows,
    fetched: {
      BTC: btc.length,
      GOLD: gold.length,
      USDPKR: usdpkr.length,
      SPY: spy.length,
      EEM: eem.length,
      BNO: bno.length,
      TBILL: rows.filter((r) => r.asset === "TBILL").length,
    },
  };
}

/**
 * Collapse rows to one per (asset, date). Providers sometimes return two bars
 * that reduce to the same calendar date once the time component is sliced off
 * (a settled daily bar plus a partial bar for the session in progress), and
 * Postgres rejects the entire batch when a single upsert touches one row twice.
 * Last value wins, which favours the more recent bar.
 */
function dedupeRows(rows: MacroAssetRow[]): MacroAssetRow[] {
  const byKey = new Map<string, MacroAssetRow>();
  for (const r of rows) byKey.set(`${r.asset}|${r.asof_date}`, r);
  return [...byKey.values()];
}

/** Upsert macro rows into the shared cache. Returns number written. */
export async function writeMacroAssetRows(admin: SupabaseClient, input: MacroAssetRow[]): Promise<number> {
  const rows = dedupeRows(input);
  if (rows.length === 0) return 0;
  // Chunk to stay well under request-size limits.
  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await admin.from("macro_asset_history").upsert(chunk, { onConflict: "asset,asof_date" });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

// --- Reading + data quality ------------------------------------------------

export type DataQuality = "good" | "limited" | "stale" | "missing";

export interface MacroSeries {
  asset: MacroAsset;
  /** PKR-denominated level for BTC/GOLD; native rate for USDPKR; yield% for TBILL. */
  points: MacroPoint[];
  quality: DataQuality;
  firstDate: string | null;
  lastDate: string | null;
  /** Years of coverage, for evidence-period reporting. */
  years: number;
}

/**
 * Read a macro series from the cache, in the unit the engine wants:
 *  - BTC/GOLD  -> PKR level (close_pkr)
 *  - USDPKR    -> the rate (close_native)
 *  - TBILL     -> yield % (close_native)
 *
 * Supabase PostgREST enforces a server-side max_rows (typically 1,000).
 * We paginate through the full table to get all available history.
 */
export async function readMacroSeries(
  supabase: SupabaseClient,
  asset: MacroAsset,
  asOf = new Date()
): Promise<MacroSeries> {
  const PAGE = 1000;
  const allRows: { asof_date: string; close_native: number; close_pkr: number | null }[] = [];
  let offset = 0;
   
  while (true) {
    const { data } = await supabase
      .from("macro_asset_history")
      .select("asof_date, close_native, close_pkr")
      .eq("asset", asset)
      .order("asof_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    const rows = data ?? [];
    allRows.push(...rows);
    if (rows.length < PAGE) break;  // last page
    offset += PAGE;
  }

  const usePkr = asset === "BTC" || asset === "GOLD";
  const points: MacroPoint[] = allRows
    .map((r) => ({ date: r.asof_date as string, value: Number(usePkr ? r.close_pkr : r.close_native) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0);

  return { asset, ...assessDataQuality(points, asOf) };
}

/**
 * Grade a series on coverage and staleness so downstream confidence can reflect
 * it. "stale" wins over "limited": a long but outdated series is still risky.
 */
export function assessDataQuality(
  points: MacroPoint[],
  asOf = new Date()
): { points: MacroPoint[]; quality: DataQuality; firstDate: string | null; lastDate: string | null; years: number } {
  if (points.length === 0) {
    return { points, quality: "missing", firstDate: null, lastDate: null, years: 0 };
  }
  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const years = (Date.parse(lastDate) - Date.parse(firstDate)) / (365.25 * 86_400_000);
  const ageDays = (asOf.getTime() - Date.parse(lastDate)) / 86_400_000;

  let quality: DataQuality = "good";
  if (ageDays > 14) quality = "stale";
  else if (years < 2 || points.length < 60) quality = "limited";
  return { points, quality, firstDate, lastDate, years };
}
