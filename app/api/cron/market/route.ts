import { marketJobHandler } from "@/lib/market/refresh-job";
import { runCron } from "@/lib/ops/job-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Market Pulse refresh job. Builds today's whole-market snapshot (prices,
 * breadth, sectors, movers), refreshes the official events feed, and
 * regenerates the AI brief from the fresh aggregates. The body is in
 * lib/market/refresh-job.ts.
 *
 * Protected by CRON_SECRET (Bearer header or ?key=).
 *   ?task=snapshot|events|brief|flows|macro|all (default all)
 *   ?brief=1 to force brief regeneration
 */
export const GET = (request: Request) => runCron("market", request, marketJobHandler);
