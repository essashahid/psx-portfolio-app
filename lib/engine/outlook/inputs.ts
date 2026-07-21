import type { SupabaseClient } from "@supabase/supabase-js";
import { PBS_NATIONAL_CPI } from "@/lib/market-data/pbs-cpi";
import { tbillYieldOn } from "@/lib/market-data/macro-assets";

/**
 * Aligned point-in-time inputs for the Phase 2 signal engine.
 *
 * Everything is keyed to the KSE-100 trading calendar, and every non-PSX
 * series carries the lag its real publication schedule imposes. The lags are
 * decided here, once, rather than inside each signal, because look-ahead
 * leakage at the loading layer silently poisons every signal built on top:
 *
 *  - SPY / EEM / gold / USD-PKR: the US session (and the daily bar most
 *    providers stamp) closes after the PSX close, so the value knowable at a
 *    PKT close is the PREVIOUS day's bar. All four are lagged one day.
 *  - CPI: PBS publishes a month's CPI early in the following month. The value
 *    usable on a date is the latest month published at least ~35 days before
 *    it, never the month in progress.
 *  - FIPI/LIPI flows: published in the evening after the session. Lagged one
 *    session so a signal at close t only sees flows through t-1.
 *  - PSX series (indices, breadth): computed from the same session's closes,
 *    available at the close, predicting t+1 onward. No lag.
 */

export interface AlignedInputs {
  /** KSE-100 trading dates, oldest first. The master calendar. */
  dates: string[];
  /** KSE-100 closes, same order as `dates`. */
  kse100: number[];
  kse100Volume: (number | null)[];
  /** Secondary PSX indices, null where the portal had no bar. */
  allshr: (number | null)[];
  kse30: (number | null)[];
  kmi30: (number | null)[];
  /** Reconstructed breadth, null before its usable window. */
  breadth: {
    advanceShare: (number | null)[];
    pctAboveMa200: (number | null)[];
    newLowsShare: (number | null)[];
    dispersion: (number | null)[];
    upVolumeShare: (number | null)[];
  };
  /** FIPI net USD mn, lagged one session. Null where the source had no data. */
  fipiNet: (number | null)[];
  /** Non-PSX daily series, each lagged one day. */
  usdPkr: (number | null)[];
  goldUsd: (number | null)[];
  spy: (number | null)[];
  eem: (number | null)[];
  /** Brent crude proxy (BNO ETF, USD), lagged one day. */
  brent: (number | null)[];
  /** Policy rate (%) in effect on the date. Real-time, no lag. */
  policyRate: number[];
  /** CPI year-on-year (%) with publication lag, null before coverage. */
  cpiYoY: (number | null)[];
}

const PAGE = 1000;

async function pageAll<T>(
  build: (from: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function closesFor(supabase: SupabaseClient, ticker: string): Promise<Map<string, { close: number; volume: number | null }>> {
  const rows = await pageAll<{ price_date: string; close: number; volume: number | null }>((from) =>
    supabase
      .from("company_price_history")
      .select("price_date, close, volume")
      .eq("ticker", ticker)
      .order("price_date", { ascending: true })
      .range(from, from + PAGE - 1)
  );
  const map = new Map<string, { close: number; volume: number | null }>();
  for (const r of rows) {
    const close = Number(r.close);
    if (Number.isFinite(close) && close > 0) map.set(r.price_date, { close, volume: r.volume === null ? null : Number(r.volume) });
  }
  return map;
}

async function macroSeries(supabase: SupabaseClient, asset: string): Promise<{ date: string; value: number }[]> {
  const rows = await pageAll<{ asof_date: string; close_native: number }>((from) =>
    supabase
      .from("macro_asset_history")
      .select("asof_date, close_native")
      .eq("asset", asset)
      .order("asof_date", { ascending: true })
      .range(from, from + PAGE - 1)
  );
  return rows
    .map((r) => ({ date: r.asof_date, value: Number(r.close_native) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0);
}

/**
 * Value knowable at each master date under a strict one-day lag: the latest
 * observation strictly BEFORE the date. Series with their own calendars
 * (US sessions, 24h markets) forward-fill across PSX holidays naturally.
 */
function laggedLookup(series: { date: string; value: number }[], dates: string[]): (number | null)[] {
  const out: (number | null)[] = [];
  let i = 0;
  let last: number | null = null;
  for (const date of dates) {
    while (i < series.length && series[i].date < date) {
      last = series[i].value;
      i++;
    }
    out.push(last);
  }
  return out;
}

/** CPI YoY (%) usable on a date: latest month published ~35 days before it. */
function cpiYoYWithLag(date: string): number | null {
  const asOf = new Date(`${date}T00:00:00Z`);
  asOf.setUTCDate(asOf.getUTCDate() - 35);
  const usableMonth = asOf.toISOString().slice(0, 7);
  const months = Object.keys(PBS_NATIONAL_CPI).sort();
  let month: string | null = null;
  for (const m of months) {
    if (m <= usableMonth) month = m;
    else break;
  }
  if (!month) return null;
  const [y, mm] = month.split("-").map(Number);
  const priorDate = new Date(Date.UTC(y, mm - 1 - 12, 1));
  const priorKey = `${priorDate.getUTCFullYear()}-${String(priorDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const latest = PBS_NATIONAL_CPI[month];
  const yearAgo = PBS_NATIONAL_CPI[priorKey];
  if (latest === undefined || yearAgo === undefined || yearAgo <= 0) return null;
  return (latest / yearAgo - 1) * 100;
}

export async function loadAlignedInputs(supabase: SupabaseClient): Promise<AlignedInputs> {
  const [kse100Map, allshrMap, kse30Map, kmi30Map] = await Promise.all([
    closesFor(supabase, "KSE100"),
    closesFor(supabase, "ALLSHR"),
    closesFor(supabase, "KSE30"),
    closesFor(supabase, "KMI30"),
  ]);

  const dates = [...kse100Map.keys()].sort();

  const breadthRows = await pageAll<{
    trade_date: string;
    counted: number;
    advance_share: number | null;
    pct_above_ma200: number | null;
    new_lows_52w: number | null;
    return_dispersion: number | null;
    up_volume: number | null;
    down_volume: number | null;
  }>((from) =>
    supabase
      .from("market_breadth_history")
      .select("trade_date, counted, advance_share, pct_above_ma200, new_lows_52w, return_dispersion, up_volume, down_volume")
      .order("trade_date", { ascending: true })
      .range(from, from + PAGE - 1)
  );
  const breadthMap = new Map(breadthRows.map((r) => [r.trade_date, r]));

  const flowRows = await pageAll<{ flow_date: string; fipi_net: number | null }>((from) =>
    supabase
      .from("foreign_flow_days")
      .select("flow_date, fipi_net")
      .order("flow_date", { ascending: true })
      .range(from, from + PAGE - 1)
  );
  const flowSeries = flowRows
    .filter((r) => r.fipi_net !== null && Number.isFinite(Number(r.fipi_net)))
    .map((r) => ({ date: r.flow_date, value: Number(r.fipi_net) }));

  const [usdPkrRaw, goldRaw, spyRaw, eemRaw, brentRaw] = await Promise.all([
    macroSeries(supabase, "USDPKR"),
    macroSeries(supabase, "GOLD"),
    macroSeries(supabase, "SPY"),
    macroSeries(supabase, "EEM"),
    macroSeries(supabase, "BNO"),
  ]);

  const numOrNull = (v: number | null | undefined): number | null =>
    v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

  return {
    dates,
    kse100: dates.map((d) => kse100Map.get(d)!.close),
    kse100Volume: dates.map((d) => kse100Map.get(d)!.volume),
    allshr: dates.map((d) => allshrMap.get(d)?.close ?? null),
    kse30: dates.map((d) => kse30Map.get(d)?.close ?? null),
    kmi30: dates.map((d) => kmi30Map.get(d)?.close ?? null),
    breadth: {
      advanceShare: dates.map((d) => numOrNull(breadthMap.get(d)?.advance_share)),
      pctAboveMa200: dates.map((d) => numOrNull(breadthMap.get(d)?.pct_above_ma200)),
      newLowsShare: dates.map((d) => {
        const row = breadthMap.get(d);
        if (!row || row.new_lows_52w === null || !row.counted) return null;
        return Number(row.new_lows_52w) / Number(row.counted);
      }),
      dispersion: dates.map((d) => numOrNull(breadthMap.get(d)?.return_dispersion)),
      upVolumeShare: dates.map((d) => {
        const row = breadthMap.get(d);
        const up = numOrNull(row?.up_volume);
        const down = numOrNull(row?.down_volume);
        if (up === null || down === null || up + down <= 0) return null;
        return up / (up + down);
      }),
    },
    // Lagged one session: the map lookup below uses strictly-before semantics.
    fipiNet: laggedLookupExact(flowSeries, dates),
    usdPkr: laggedLookup(usdPkrRaw, dates),
    goldUsd: laggedLookup(goldRaw, dates),
    spy: laggedLookup(spyRaw, dates),
    eem: laggedLookup(eemRaw, dates),
    brent: laggedLookup(brentRaw, dates),
    policyRate: dates.map((d) => tbillYieldOn(d)),
    cpiYoY: dates.map((d) => cpiYoYWithLag(d)),
  };
}

/**
 * Flows differ from the 24h global series: they exist only on PSX sessions, so
 * forward-filling a week-old reading across a gap would fabricate activity.
 * Under the one-session lag, the value at date t is the previous session's
 * flow if the source had it, else null.
 */
function laggedLookupExact(series: { date: string; value: number }[], dates: string[]): (number | null)[] {
  const byDate = new Map(series.map((p) => [p.date, p.value]));
  const out: (number | null)[] = [];
  for (let i = 0; i < dates.length; i++) {
    out.push(i === 0 ? null : (byDate.get(dates[i - 1]) ?? null));
  }
  return out;
}
