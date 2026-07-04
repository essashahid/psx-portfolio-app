import { cn } from "@/lib/utils";

/**
 * One phrasing of data freshness used across the app, so "as of" reads the same
 * everywhere and staleness is signalled consistently. Trust in the numbers is
 * the product; this is how that trust is communicated.
 */
export function AsOf({
  date,
  time,
  label = "Updated",
  staleAfterDays = 4,
  className,
}: {
  date: string | null;
  time?: string | null;
  label?: string;
  staleAfterDays?: number;
  className?: string;
}) {
  if (!date) {
    return <span className={cn("text-xs text-muted-foreground", className)}>No data yet</span>;
  }

  const display = new Intl.DateTimeFormat("en-PK", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${date}T12:00:00`)
  );
  // Server component rendered once per request; reading the clock here is fine.
  // eslint-disable-next-line react-hooks/purity
  const ageDays = Math.floor((Date.now() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000);
  const stale = ageDays > staleAfterDays;
  const clock = time ? `, ${time.slice(0, 5)}` : "";

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", stale ? "text-amber-700" : "text-muted-foreground", className)}>
      {stale && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />}
      {label} {display}{clock} PKT
      {stale && <span className="text-amber-700">· {ageDays}d old</span>}
    </span>
  );
}
