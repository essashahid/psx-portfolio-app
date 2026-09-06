import { backfillJobHandler } from "@/lib/engine/backfill-job";
import { runCron } from "@/lib/ops/job-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron entry point for the cheap-fundamentals backfill (PSX company page +
 * payout history + ratios, no LLM). A dedicated path because vercel.json cron
 * paths carry no query string; delegates to /api/cron/backfill?task=fundamentals.
 */
async function handler(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/fundamentals$/, "");
  url.searchParams.set("task", "fundamentals");
  return backfillJobHandler(new Request(url, { headers: request.headers }));
}

export const GET = (request: Request) => runCron("backfill/fundamentals", request, handler);
