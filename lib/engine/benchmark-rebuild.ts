import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBenchmarkSeries, type Contribution, type ShareEvent, type ClosePoint } from "@/lib/engine/benchmark-growth";
import { buildLedgerRows, type LedgerTxnInput, type LedgerCashInput } from "@/lib/engine/ledger-view";
import { ensureEodCached, getCachedEod, KSE_SYMBOL } from "@/lib/market-data/eod-cache";

/**
 * Rebuilds the dashboard benchmark series (`benchmark_series`) from the live DB
 * ledger instead of the offline PDF script, so it stays consistent on every
 * edit. Reuses the pure `buildBenchmarkSeries` engine; this layer only assembles
 * its inputs from `transactions` + `cash_movements` + cached EOD prices.
 *
 * Split handling: PSX EOD prices are back-adjusted for splits, so share counts
 * must be expressed in current (post-split) units to line up. We derive a
 * per-ticker adjustment factor from `SPLIT` transactions — any share event
 * dated before a split is scaled by that split's factor.
 */

const SHARE_TYPES = new Set(["BUY", "SELL", "RIGHT", "BONUS", "ADJUST"]);

export async function rebuildBenchmarkSeries(
  supabase: SupabaseClient,
  userId: string
): Promise<{ points: number } | null> {
  const [txnsRes, cashRes, hiddenRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, trade_date, type, ticker, quantity, price, net_amount, notes")
      .eq("user_id", userId)
      .order("trade_date", { ascending: true }),
    supabase
      .from("cash_movements")
      .select("id, movement_date, type, amount, description")
      .eq("user_id", userId)
      .order("movement_date", { ascending: true }),
    supabase.from("holdings").select("ticker").eq("user_id", userId).eq("hidden", true),
  ]);
  // Hidden positions are excluded from the portfolio value line (their share
  // events are dropped below); the cash series keeps every transaction because
  // cash that moved is real either way.
  const hiddenTickers = new Set((hiddenRes.data ?? []).map((h) => h.ticker as string));
  const txns = (txnsRes.data ?? []) as LedgerTxnInput[];
  const cash = (cashRes.data ?? []) as LedgerCashInput[];
  if (txns.length === 0 && cash.length === 0) return null;

  // Per-ticker split events → adjustment factor for earlier-dated share events.
  const splitsByTicker = new Map<string, { date: string; factor: number }[]>();
  for (const t of txns) {
    if (t.type !== "SPLIT" || !t.ticker || !t.trade_date) continue;
    const list = splitsByTicker.get(t.ticker) ?? [];
    list.push({ date: t.trade_date, factor: Number(t.quantity ?? 1) || 1 });
    splitsByTicker.set(t.ticker, list);
  }
  const splitFactorAfter = (ticker: string, date: string) =>
    (splitsByTicker.get(ticker) ?? []).reduce((f, s) => (s.date > date ? f * s.factor : f), 1);

  // Share events in current (split-adjusted) units.
  const shareEvents: ShareEvent[] = [];
  for (const t of txns) {
    if (!t.ticker || !t.trade_date || !SHARE_TYPES.has(t.type)) continue;
    if (hiddenTickers.has(t.ticker)) continue;
    const raw = Number(t.quantity ?? 0);
    let qty: number;
    if (t.type === "SELL") qty = -Math.abs(raw);
    else if (t.type === "ADJUST") qty = raw; // already signed
    else qty = Math.abs(raw); // BUY / RIGHT / BONUS
    shareEvents.push({ date: t.trade_date, ticker: t.ticker, qtyDelta: qty * splitFactorAfter(t.ticker, t.trade_date) });
  }

  // Contributions = external cash in (deposits + IPO funding modelled as CASH_IN).
  const contributions: Contribution[] = cash
    .filter((c) => c.type === "CASH_IN" && c.movement_date)
    .map((c) => ({ date: c.movement_date as string, amount: Math.abs(Number(c.amount)) }));
  if (contributions.length === 0) return null;

  // Running broker cash on hand over time.
  const { rows } = buildLedgerRows(txns, cash);
  const cashSeries: ClosePoint[] = rows
    .filter((r) => r.date)
    .map((r) => ({ date: r.date as string, close: r.balance }));

  // Cached price history; fill an at-cost par point for positions acquired
  // before their first listed close (e.g. IPO allotments).
  const tickers = [...new Set(shareEvents.map((e) => e.ticker))];
  const priceSeries = await getCachedEod(supabase, tickers);
  const firstBuyPrice = new Map<string, { date: string; price: number }>();
  for (const t of txns) {
    if (t.type !== "BUY" || !t.ticker || !t.trade_date || !t.price) continue;
    if (!firstBuyPrice.has(t.ticker)) firstBuyPrice.set(t.ticker, { date: t.trade_date, price: Number(t.price) });
  }
  for (const ticker of tickers) {
    const series = priceSeries.get(ticker) ?? [];
    const seed = firstBuyPrice.get(ticker);
    if (seed && (series.length === 0 || series[0].date > seed.date)) {
      priceSeries.set(ticker, [{ date: seed.date, close: seed.price }, ...series]);
    }
  }

  const kse100 = priceSeries.get(KSE_SYMBOL) ?? [];
  if (kse100.length === 0) return null;
  const lastDates = [kse100.at(-1)!.date, ...[...priceSeries.values()].map((s) => s.at(-1)?.date ?? "")].filter(Boolean).sort();
  const asOf = lastDates.at(-1)!;

  const series = buildBenchmarkSeries({ contributions, shareEvents, cashSeries, priceSeries, kse100, asOf });

  await supabase.from("benchmark_series").delete().eq("user_id", userId);
  if (series.length > 0) {
    const { error } = await supabase.from("benchmark_series").upsert(
      series.map((p) => ({
        user_id: userId,
        point_date: p.date,
        contributed: p.contributed,
        portfolio: p.portfolio,
        kse100: p.kse100,
        inflation: p.inflation,
        cpi: p.cpi,
      })),
      { onConflict: "user_id,point_date" }
    );
    if (error) throw error;
  }
  return { points: series.length };
}

/**
 * Warm the EOD cache for the user's traded tickers, then rebuild the benchmark
 * series. The one entry point every price-moving flow (ledger edits, the daily
 * job, manual price refresh) should call so the growth chart tracks the header.
 */
export async function refreshBenchmarkForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{ points: number } | null> {
  const { data: tickerRows } = await supabase
    .from("transactions")
    .select("ticker")
    .eq("user_id", userId);
  const tickers = [...new Set((tickerRows ?? []).map((r) => r.ticker as string).filter(Boolean))];
  if (tickers.length === 0) return null;
  await ensureEodCached(tickers);
  return rebuildBenchmarkSeries(supabase, userId);
}
