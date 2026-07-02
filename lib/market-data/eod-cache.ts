import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";

/**
 * Shared PSX end-of-day close cache (public.eod_history).
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
}

/** Refetch a symbol when we have nothing cached or the latest day is older than this. */
const STALE_AFTER_DAYS = 1;

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

  // Latest cached date per symbol in one query.
  const { data: latestRows } = await admin
    .from("eod_history")
    .select("ticker, trade_date")
    .in("ticker", symbols)
    .order("trade_date", { ascending: false });
  const latestByTicker = new Map<string, string>();
  for (const row of latestRows ?? []) {
    if (!latestByTicker.has(row.ticker)) latestByTicker.set(row.ticker, row.trade_date as string);
  }

  const refreshed: string[] = [];
  const skipped: string[] = [];
  for (const symbol of symbols) {
    const latest = latestByTicker.get(symbol) ?? null;
    if (!opts.force && !isStale(latest)) { skipped.push(symbol); continue; }
    const eod = await fetchPsxEod(symbol);
    const fresh = uniqueByDate(eod.filter((c) => !latest || c.date > latest));
    if (fresh.length === 0) { skipped.push(symbol); continue; }
    const { error } = await admin.from("eod_history").upsert(
      fresh.map((c) => ({ ticker: symbol, trade_date: c.date, close: c.close })),
      { onConflict: "ticker,trade_date" }
    );
    if (!error) refreshed.push(symbol);
    else skipped.push(symbol);
  }
  return { refreshed, skipped };
}

/** Reads cached daily closes for the given symbols (+ KSE-100), oldest first. */
export async function getCachedEod(
  supabase: SupabaseClient,
  tickers: string[]
): Promise<Map<string, ClosePoint[]>> {
  const symbols = [...new Set([KSE_SYMBOL, ...tickers.map((t) => t.toUpperCase())])];
  const byTicker = new Map<string, ClosePoint[]>();
  // Page through to avoid the default 1000-row cap (5y * ~17 symbols ≈ 20k rows).
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("eod_history")
      .select("ticker, trade_date, close")
      .in("ticker", symbols)
      .order("trade_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const list = byTicker.get(row.ticker) ?? [];
      list.push({ date: row.trade_date as string, close: Number(row.close) });
      byTicker.set(row.ticker, list);
    }
    if (data.length < PAGE) break;
  }
  return byTicker;
}
