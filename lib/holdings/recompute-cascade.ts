import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeHoldingsFromTransactions, takeSnapshot } from "@/lib/portfolio";
import { enrichHoldingsMetadata } from "@/lib/holdings/enrichment";
import { refreshAlerts } from "@/lib/alerts";
import { ensureEodCached } from "@/lib/market-data/eod-cache";
import { rebuildBenchmarkSeries } from "@/lib/engine/benchmark-rebuild";

/**
 * The single recompute cascade run after any ledger mutation (add/edit/delete
 * of a trade, deposit or holding adjustment). The ledger is the source of
 * truth; this re-derives everything downstream so the whole platform stays
 * consistent in one save:
 *   holdings → metadata → daily snapshot → benchmark series → alerts.
 *
 * Holdings + benchmark are core and surface errors; metadata, snapshot and
 * alerts are best-effort and never block the save.
 */
export async function recomputeAll(
  supabase: SupabaseClient,
  userId: string,
  opts: { changedTickers?: string[] } = {}
): Promise<void> {
  // 1. Holdings from transactions (authoritative quantities + realized P/L).
  await recomputeHoldingsFromTransactions(supabase, userId);

  // 2. Best-effort metadata enrichment for changed tickers.
  if (opts.changedTickers?.length) {
    try {
      await enrichHoldingsMetadata(supabase, userId, { tickers: opts.changedTickers });
    } catch {
      /* non-fatal */
    }
  }

  // 3. Daily snapshot for the dashboard value-over-time chart.
  try {
    await takeSnapshot(supabase, userId);
  } catch {
    /* non-fatal */
  }

  // 4. Benchmark series — warm the EOD cache for current tickers, then rebuild.
  try {
    const { data: tickerRows } = await supabase
      .from("transactions")
      .select("ticker")
      .eq("user_id", userId);
    const tickers = [...new Set((tickerRows ?? []).map((r) => r.ticker as string).filter(Boolean))];
    await ensureEodCached(tickers);
    await rebuildBenchmarkSeries(supabase, userId);
  } catch (err) {
    // Benchmark is important but should not fail the whole save; log for visibility.
    console.error("benchmark rebuild failed", err);
  }

  // 5. Refresh alerts off the new holdings.
  try {
    await refreshAlerts(supabase, userId);
  } catch {
    /* non-fatal */
  }
}
