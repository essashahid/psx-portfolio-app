import { marketJobHandler } from "@/lib/market/refresh-job";
import { runCron } from "@/lib/ops/job-runs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily cron entry point for the non-PSX macro assets — Bitcoin, gold, USD/PKR
 * and the T-bill path.
 *
 * Separate from the weekday market cron because these follow their own
 * calendars rather than the exchange's. Bitcoin trades every day of the week,
 * so it is refreshed every day of the week — from here, on one schedule, rather
 * than split across the weekday market job and a weekend top-up. Splitting a
 * 24/7 asset over two schedules works until one of them moves, and then it
 * fails silently and invisibly: a stale price still renders as a price.
 *
 * The weekday market cron reaches this same task through ?task=all, so on
 * Monday to Friday the assets get a second attempt. That redundancy is cheap
 * and is the reason a failure here does not go straight to a stale tape.
 *
 * A dedicated path because vercel.json cron paths carry no query string;
 * delegates to /api/cron/market?task=macro. The PSX index top-up inside that
 * task carries its own weekday guard, so reaching it on a Sunday is safe.
 */
async function handler(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/macro$/, "");
  url.searchParams.set("task", "macro");
  return marketJobHandler(new Request(url, { headers: request.headers }));
}

export const GET = (request: Request) => runCron("market/macro", request, handler);
