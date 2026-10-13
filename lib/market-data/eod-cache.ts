import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";

/**
 * Shared PSX end-of-day close cache (public.company_price_history).
 *
 * The benchmark recompute that runs on every ledger edit needs daily close
 * history for the KSE-100 and each held ticker. Hitting dps.psx.com.pk for ~17
 * symbols on every save would be slow and flaky, so history is cached in the
 * DB: `ensureEodCached` tops up missing/stale symbols (only new dates are
 * written), and `getCachedEod` is a fast read used in the hot path.
 */

export const KSE_SYMBOL = "KSE100";

export interface ClosePoint {
  date: string; // YYYY-MM-DD
  close: number;
  volume?: number | null;
}

/** Refetch a symbol when we have nothing cached or the latest day is older than this. */
const STALE_AFTER_DAYS = 1;

/** How far back the "latest cached date" lookup scans before falling back to per-symbol reads. */
const LATEST_LOOKBACK_DAYS = 14;

/** YYYY-MM-DD for `days` days before today (UTC). */
export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function isStale(latest: string | null): boolean {
  if (!latest) return true;
  const ageMs = Date.now() - new Date(`${latest}T00:00:00Z`).getTime();
  return ageMs > STALE_AFTER_DAYS * 86_400_000;
}

function uniqueByDate(points: ClosePoint[]): ClosePoint[] {
  const byDate = new Map<string, ClosePoint>();
  for (const point of points) byDate.set(point.date, point);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Ensures `tickers` (plus the KSE-100 index) have fresh EOD history cached.
 * Writes go through the service-role client. Only dates newer than what is
 * already cached are inserted, so steady-state top-ups are cheap.
 */
export async function ensureEodCached(
  tickers: string[],
  opts: { force?: boolean } = {}
): Promise<{ refreshed: string[]; skipped: string[] }> {
  const admin = createAdminClient();
  const symbols = [...new Set([KSE_SYMBOL, ...tickers.map((t) => t.toUpperCase())])];

  // Latest cached date per symbol. Look in a short recent window first (one
  // small query covers every symbol that is up to date), then ask only for the
  // symbols that window missed, one row each. Reading the whole history just to
  // find its newest date was a large share of this project's egress.
  const latestByTicker = new Map<string, string>();
  const { data: recentRows } = await admin
    .from("company_price_history")
    .select("ticker, price_date")
    .in("ticker", symbols)
    .gte("price_date", daysAgo(LATEST_LOOKBACK_DAYS))
    .order("price_date", { ascending: false });
  for (const row of recentRows ?? []) {
    if (!latestByTicker.has(row.ticker)) latestByTicker.set(row.ticker, row.price_date as string);
  }
  const unresolved = symbols.filter((s) => !latestByTicker.has(s));
  await Promise.all(
    unresolved.map(async (symbol) => {
      const { data } = await admin
        .from("company_price_history")
        .select("price_date")
        .eq("ticker", symbol)
        .order("price_date", { ascending: false })
        .limit(1);
      const latest = data?.[0]?.price_date as string | undefined;
      if (latest) latestByTicker.set(symbol, latest);
    })
  );

  const refreshed: string[] = [];
  const skipped: string[] = [];
  for (const symbol of symbols) {
    const latest = latestByTicker.get(symbol) ?? null;
    if (!opts.force && !isStale(latest)) { skipped.push(symbol); continue; }
    const eod = await fetchPsxEod(symbol);
    const fresh = uniqueByDate(eod.filter((c) => !latest || c.date > latest));
    if (fresh.length === 0) { skipped.push(symbol); continue; }
    const now = new Date().toISOString();
    const { error } = await admin.from("company_price_history").upsert(
      fresh.map((c) => ({ ticker: symbol, price_date: c.date, close: c.close, volume: c.volume, source: "psx-dps", updated_at: now })),
      { onConflict: "ticker,price_date" }
    );
    if (!error) refreshed.push(symbol);
    else skipped.push(symbol);
  }
  return { refreshed, skipped };
}

/**
 * Reads cached daily closes for the given symbols (+ KSE-100), oldest first.
 *
 * Pass `since` (YYYY-MM-DD) whenever the caller only needs a recent window.
 * Without it this reads the full history of every symbol (~20k rows for a
 * typical portfolio), which is the single largest source of database egress
 * in this app, so new callers should always bound it.
 */
export async function getCachedEod(
  supabase: SupabaseClient,
  tickers: string[],
  opts: { since?: string } = {}
): Promise<Map<string, ClosePoint[]>> {
  const symbols = [...new Set([KSE_SYMBOL, ...tickers.map((t) => t.toUpperCase())])];
  const byTicker = new Map<string, ClosePoint[]>();
  // Page through to avoid the default 1000-row cap.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("company_price_history")
      .select("ticker, price_date, close")
      .in("ticker", symbols);
    if (opts.since) query = query.gte("price_date", opts.since);
    const { data, error } = await query
      .order("price_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const list = byTicker.get(row.ticker) ?? [];
      list.push({ date: row.price_date as string, close: Number(row.close) });
      byTicker.set(row.ticker, list);
    }
    if (data.length < PAGE) break;
  }
  return byTicker;
}
