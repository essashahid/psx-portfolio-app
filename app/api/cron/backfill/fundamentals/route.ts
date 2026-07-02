import { GET as backfill } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron entry point for the cheap-fundamentals backfill (PSX company page +
 * payout history + ratios, no LLM). A dedicated path because vercel.json cron
 * paths carry no query string; delegates to /api/cron/backfill?task=fundamentals.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/fundamentals$/, "");
  url.searchParams.set("task", "fundamentals");
  return backfill(new Request(url, { headers: request.headers }));
}
