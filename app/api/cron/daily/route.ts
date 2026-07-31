import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyUpdate } from "@/lib/dividends/daily";
import { syncNewsClusters } from "@/lib/news/global-store";
import { isPsxWeekday } from "@/lib/market/trading-day";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * How long the per-user loop may run before it stops taking new accounts.
 *
 * Overrunning maxDuration is not a slow run, it is a lost one: the platform
 * kills the invocation, so the account being processed is left half updated,
 * the shared news-cluster sync at the end never happens, and nothing records
 * that any of it was skipped. Stopping early and saying so is strictly better,
 * and the ordering below makes the remainder the next run's first work.
 */
const USER_BUDGET_MS = 220_000;

/**
 * Daily scheduled update for every user.
 *
 * Triggered by a scheduled job (Vercel Cron, an OS cron `curl`, or Supabase
 * pg_cron). Protected by CRON_SECRET — the caller must send it either as
 * `Authorization: Bearer <secret>` (Vercel Cron style) or `?key=<secret>`.
 * Runs the proactive dividend/price/forecast/reconcile pipeline per user and
 * writes each user's "what changed" digest.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 503 }
    );
  }
  const url = new URL(request.url);
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();

  // News and dividend announcements keep arriving at the weekend; PSX prices do
  // not. The run happens either way, without the pointless price fetch.
  const tradingDay = isPsxWeekday();

  // Users who actually hold something — no point scanning empty accounts.
  const { data: holders, error } = await admin.from("holdings").select("user_id").gt("quantity", 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const userIds = [...new Set((holders ?? []).map((h) => String(h.user_id)))];

  // Stalest account first. A run costs price fetches, announcement PDF reads
  // and a news sweep per user, so the whole set does not always fit in one
  // invocation; ordering by the last completed run means the budget below
  // rotates through everyone over successive days instead of always spending
  // itself on the same few accounts and starving the rest.
  const { data: lastRuns } = await admin.from("portfolio_changelog").select("user_id, run_date");
  const lastRunByUser = new Map<string, string>();
  for (const row of lastRuns ?? []) {
    const uid = String(row.user_id);
    const seen = lastRunByUser.get(uid);
    const at = String(row.run_date);
    if (!seen || at > seen) lastRunByUser.set(uid, at);
  }
  userIds.sort((a, b) => (lastRunByUser.get(a) ?? "").localeCompare(lastRunByUser.get(b) ?? ""));

  const results: { user_id: string; ok: boolean; highlights?: string[]; error?: string }[] = [];
  let skipped = 0;
  for (const userId of userIds) {
    // Leave enough of the budget for the cluster sync below, which is shared by
    // every user and must not be the step that gets cut.
    if (Date.now() - startedAt > USER_BUDGET_MS) {
      skipped++;
      continue;
    }
    try {
      const summary = await runDailyUpdate(admin, userId, { skipPrices: !tradingDay });
      results.push({ user_id: userId, ok: true, highlights: summary.highlights });
    } catch (e) {
      results.push({ user_id: userId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Recompute the shared news clusters once, after all users have refreshed the
  // global article store, so article counts are correct without per-user churn.
  const clusters = await syncNewsClusters(admin);

  return NextResponse.json({
    ok: true,
    run_date: new Date().toISOString().slice(0, 10),
    trading_day: tradingDay,
    prices_refreshed: tradingDay,
    users_processed: results.length,
    users_deferred: skipped,
    elapsed_ms: Date.now() - startedAt,
    clusters_synced: clusters,
    results,
  });
}
