/**
 * Whether the PSX trades on a given day.
 *
 * PKT is UTC+5 with no daylight saving, so the Karachi weekday is read off the
 * shifted UTC date rather than the server's local zone, which on a UTC or US
 * host would otherwise disagree with Pakistan for part of every day.
 *
 * This is the weekly calendar only. PSX also closes for public holidays, which
 * fall on weekdays and move each year with the lunar calendar; those are not
 * encoded here. Jobs that must not write a non-session close should continue to
 * check whether the exchange actually produced a new bar, rather than trusting
 * the day of the week alone.
 */

const PKT_OFFSET_MINUTES = 5 * 60;

/** The Karachi calendar date for an instant, as YYYY-MM-DD. */
export function pktDate(at: Date = new Date()): string {
  return new Date(at.getTime() + PKT_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Monday to Friday in Karachi. Saturday and Sunday are closed. */
export function isPsxWeekday(at: Date = new Date()): boolean {
  const day = new Date(at.getTime() + PKT_OFFSET_MINUTES * 60_000).getUTCDay();
  return day >= 1 && day <= 5;
}

/** PSX regular session, Karachi time. */
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 15 * 60 + 30;

/**
 * Whether the exchange is trading right now.
 *
 * This is what gates the one pulse in the product. A pulse running against a
 * stale figure is a claim about freshness the data does not support, so it has
 * to stop at the close — which means the answer has to be recomputed while a
 * screen is open, not decided once when it rendered.
 */
export function isMarketOpen(at: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  if (!isPsxWeekday(at)) return false;

  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
}
