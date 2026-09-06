import { cn } from "@/lib/shared/format";
import { MarketPulse } from "@/components/shared/market-pulse";

/**
 * One phrasing of data freshness used across the app, so "as of" reads the same
 * everywhere and staleness is signalled consistently. Trust in the numbers is
 * the product; this is how that trust is communicated.
 */
/**
 * The clock half of the label, in Karachi time.
 *
 * Callers pass whatever their table holds. `market_snapshots.snapshot_time` is
 * a timestamptz, so the ISO string that arrives here starts with the date, and
 * taking its first five characters printed "2026-" where a time belonged. A
 * bare "HH:MM:SS" is still accepted because that is what a `time` column gives.
 */
function pktClock(time: string | null | undefined): string {
  if (!time) return "";
  if (/^\d{2}:\d{2}/.test(time)) return `, ${time.slice(0, 5)}`;
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) return "";
  return `, ${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).format(at)}`;
}

export function AsOf({
  date,
  time,
  label = "Updated",
  staleAfterDays = 4,
  live = false,
  className,
}: {
  date: string | null;
  time?: string | null;
  label?: string;
  staleAfterDays?: number;
  /**
   * Marks this stamp as standing against a live market figure, which earns the
   * pulse while the exchange is open. Opt-in, because most things dated here —
   * a filing, a report — are not live and a pulse beside them would claim a
   * freshness they do not have. There is one pulse in the product and this is
   * it.
   */
  live?: boolean;
  className?: string;
}) {
  if (!date) {
    return <span className={cn("text-xs text-text-muted", className)}>No data yet</span>;
  }

  const display = new Intl.DateTimeFormat("en-PK", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${date}T12:00:00`)
  );
  // Server component rendered once per request; reading the clock here is fine.
  // eslint-disable-next-line react-hooks/purity
  const ageDays = Math.floor((Date.now() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000);
  const stale = ageDays > staleAfterDays;
  const clock = pktClock(time);

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", stale ? "text-amber-700" : "text-text-muted", className)}>
      {stale && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
      {/* Stale wins: an amber dot and a pulse together would be contradictory. */}
      {live && !stale && <MarketPulse />}
      {label} {display}{clock} PKT
      {stale && <span className="text-amber-700">· {ageDays}d old</span>}
    </span>
  );
}
