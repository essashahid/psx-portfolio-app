import type { SupabaseClient } from "@supabase/supabase-js";
import { checkUpcomingDividends } from "@/lib/dividends/detect";
import { generateDividendForecasts } from "@/lib/dividends/forecast";
import { reconcileAndDedupe } from "@/lib/dividends/dedup";
import { getMarketDataProvider } from "@/lib/market-data/adapter";
import { takeSnapshot } from "@/lib/portfolio";
import { refreshNewsForUser } from "@/lib/news/refresh";
import { ensureEodCached } from "@/lib/market-data/eod-cache";
import { rebuildBenchmarkSeries } from "@/lib/engine/benchmark-rebuild";

/**
 * The daily proactive update. For one user it:
 *   1. refreshes live PSX prices,
 *   2. scans PSX announcements and converts dividend filings into receivables,
 *   3. reconciles credited filings against the ledger and flags duplicates,
 *   4. refreshes history-based forecasts,
 *   5. re-evaluates overdue status against today's date,
 *   6. records a "what changed since yesterday" digest.
 *
 * It is safe to run repeatedly (idempotent) and never overwrites user edits.
 */

export interface DailyUpdateSummary {
  run_date: string;
  prices_updated: number;
  events_staged: number;
  events_upgraded: number;
  pdfs_read: number;
  reconciled_with_ledger: number;
  duplicates_flagged: number;
  forecasts_generated: number;
  newly_overdue: number;
  confirmed_open: number;
  expected_net: number;
  overdue_total: number;
  needs_eligibility: number;
  news_inserted: number;
  highlights: string[];
  errors: string[];
}

interface SnapshotCounts {
  overdueKeys: Set<string>;
  open: number;
}

async function snapshotState(supabase: SupabaseClient, userId: string): Promise<SnapshotCounts> {
  const { data } = await supabase
    .from("dividend_events")
    .select("dedupe_key, status, is_forecast")
    .eq("user_id", userId)
    .eq("is_forecast", false);
  const overdueKeys = new Set<string>();
  let open = 0;
  for (const r of data ?? []) {
    if (r.status === "overdue") overdueKeys.add(String(r.dedupe_key));
    if (["announced", "expected", "overdue", "needs_review"].includes(String(r.status))) open++;
  }
  return { overdueKeys, open };
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0);

export async function runDailyUpdate(
  supabase: SupabaseClient,
  userId: string
): Promise<DailyUpdateSummary> {
  const runDate = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  const before = await snapshotState(supabase, userId);

  // 1. Prices
  let prices_updated = 0;
  try {
    const provider = getMarketDataProvider(supabase, userId);
    const res = await provider.refreshPortfolioPrices(userId);
    prices_updated = res.updated;
  } catch (e) {
    errors.push(`prices: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Dividend detection (reads announcement PDFs)
  let events_staged = 0;
  let events_upgraded = 0;
  let pdfs_read = 0;
  try {
    const det = await checkUpcomingDividends(supabase, userId);
    events_staged = det.staged;
    events_upgraded = det.upgraded;
    pdfs_read = det.pdfsRead;
    errors.push(...det.errors.slice(0, 5));
  } catch (e) {
    errors.push(`detect: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Reconcile + dedupe
  let reconciled_with_ledger = 0;
  let duplicates_flagged = 0;
  try {
    const dd = await reconcileAndDedupe(supabase, userId);
    reconciled_with_ledger = dd.reconciledWithLedger;
    duplicates_flagged = dd.duplicatesFlagged;
  } catch (e) {
    errors.push(`dedupe: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4. Forecasts
  let forecasts_generated = 0;
  try {
    const fc = await generateDividendForecasts(supabase, userId);
    forecasts_generated = fc.generated;
  } catch (e) {
    errors.push(`forecast: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5. Snapshot portfolio value and rebuild benchmark series if prices moved
  if (prices_updated > 0) {
    try {
      await takeSnapshot(supabase, userId);
      
      const { data: tickerRows } = await supabase
        .from("transactions")
        .select("ticker")
        .eq("user_id", userId);
      const tickers = [...new Set((tickerRows ?? []).map((r) => r.ticker as string).filter(Boolean))];
      if (tickers.length > 0) {
        await ensureEodCached(tickers);
        await rebuildBenchmarkSeries(supabase, userId);
      }
    } catch (e) {
      errors.push(`snapshot/benchmark: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 6. Recompute current open receivables for the digest
  const { data: openRows } = await supabase
    .from("dividend_events")
    .select("dedupe_key, ticker, status, event_type, net_expected, eligibility_status, is_possible_duplicate")
    .eq("user_id", userId)
    .eq("is_forecast", false)
    .in("status", ["announced", "expected", "overdue", "needs_review"]);
  const open = (openRows ?? []).filter((r) => !r.is_possible_duplicate);
  // Outstanding (not already-credited) receivables drive upcoming income.
  const outstanding = open.filter((r) => r.event_type !== "credit");
  const expected_net = sum(outstanding.map((r) => (r.net_expected !== null ? Number(r.net_expected) : null)));
  const overdueRows = open.filter((r) => r.status === "overdue");
  const overdue_total = sum(overdueRows.map((r) => (r.net_expected !== null ? Number(r.net_expected) : null)));
  const needs_eligibility = open.filter(
    (r) => r.eligibility_status === "needs_confirmation" || r.eligibility_status === "unknown"
  ).length;

  const after = await snapshotState(supabase, userId);
  const newlyOverdueKeys = [...after.overdueKeys].filter((k) => !before.overdueKeys.has(k));
  const newlyOverdueTickers = (openRows ?? [])
    .filter((r) => newlyOverdueKeys.includes(String(r.dedupe_key)))
    .map((r) => r.ticker);

  // 7. News refresh
  let news_inserted = 0;
  try {
    const nr = await refreshNewsForUser(supabase, userId);
    news_inserted = nr.inserted;
    errors.push(...nr.errors);
  } catch (e) {
    errors.push(`news: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 8. Build human-readable highlights
  const highlights: string[] = [];
  if (events_staged > 0) highlights.push(`${events_staged} new dividend event(s) detected from PSX filings`);
  if (events_upgraded > 0) highlights.push(`${events_upgraded} event(s) updated with values read from announcement PDFs`);
  if (reconciled_with_ledger > 0)
    highlights.push(`${reconciled_with_ledger} credited dividend(s) reconciled with your ledger (not double-counted)`);
  if (duplicates_flagged > 0) highlights.push(`${duplicates_flagged} possible duplicate(s) flagged`);
  if (newlyOverdueTickers.length > 0) highlights.push(`Now overdue: ${[...new Set(newlyOverdueTickers)].join(", ")}`);
  if (forecasts_generated > 0) highlights.push(`${forecasts_generated} forecast(s) refreshed`);
  if (prices_updated > 0) highlights.push(`${prices_updated} live price(s) refreshed`);
  if (news_inserted > 0) highlights.push(`${news_inserted} new article(s) added to news feed`);
  if (highlights.length === 0) highlights.push("No new activity since the last run.");

  const summary: DailyUpdateSummary = {
    run_date: runDate,
    prices_updated,
    events_staged,
    events_upgraded,
    pdfs_read,
    reconciled_with_ledger,
    duplicates_flagged,
    forecasts_generated,
    newly_overdue: newlyOverdueTickers.length,
    confirmed_open: outstanding.length,
    expected_net,
    overdue_total,
    needs_eligibility,
    news_inserted,
    highlights,
    errors: errors.slice(0, 10),
  };

  // 8. Persist the daily "what changed" record (one row per user per day)
  await supabase.from("portfolio_changelog").upsert(
    {
      user_id: userId,
      run_date: runDate,
      summary: summary as unknown as Record<string, unknown>,
      highlights,
    },
    { onConflict: "user_id,run_date" }
  );

  return summary;
}
