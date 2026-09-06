import { backfillJobHandler } from "@/lib/engine/backfill-job";
import { runCron } from "@/lib/ops/job-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;


/**
 * Universe-wide data backfill — the job responsible for keeping high-quality
 * data on EVERY stock the screener shows.
 *
 * TIMING MATTERS. This runs at 12:05 UTC (17:05 PKT), which is after both the
 * 16:30 PKT close and the market-snapshot job at 11:40 UTC. Both orderings are
 * load-bearing: running before the close means the portal has no EOD bar for
 * today and every row lands a day stale, and running before the snapshot means
 * the working set below is yesterday's. It previously ran at 10:20 UTC, during
 * the session, and could never capture the same day's close.
 *
 * The working set is the union of today's traded stocks (latest market
 * snapshot) plus holdings and watchlists. Each run processes a rotating batch,
 * oldest-data-first, so coverage completes over a handful of runs and then
 * keeps refreshing the stalest rows. Technicals are the priority (they power
 * the screener sparklines, 52-week bars and flags); financials/ratios fill in a
 * smaller slice per run since each is a separate fetch.
 *
 *   ?task=technicals | financials | all   (default technicals)
 *   ?limit=<n>   technicals batch size (default 80)
 *   ?finlimit=<n> financials batch size (default 12)
 *   ?concurrency=<n> (default 6)
 */
export const GET = (request: Request) => runCron("backfill", request, backfillJobHandler);
