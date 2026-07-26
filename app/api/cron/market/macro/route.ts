import { GET as market } from "../route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily cron entry point for the non-PSX macro assets — Bitcoin, gold, USD/PKR
 * and the T-bill path.
 *
 * Separate from the weekday market cron because these follow their own
 * calendars rather than the exchange's. Bitcoin in particular trades every day
 * of the week, so leaving it on the Monday-to-Friday schedule would have shown
 * a Friday price on the ticker tape all weekend, on the one asset a reader is
 * most likely to check then.
 *
 * A dedicated path because vercel.json cron paths carry no query string;
 * delegates to /api/cron/market?task=macro. The PSX index top-up inside that
 * task carries its own weekday guard, so reaching it on a Sunday is safe.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/macro$/, "");
  url.searchParams.set("task", "macro");
  return market(new Request(url, { headers: request.headers }));
}
