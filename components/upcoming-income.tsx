import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, cn } from "@/lib/utils";
import { HandCoins, ArrowRight } from "lucide-react";
import type { DividendEvent } from "@/lib/dividends/engine";

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0);

/**
 * Income-first dashboard panel. Answers, at a glance: how much dividend income
 * is coming, what is overdue, what needs eligibility confirmation, and when the
 * next payment window opens. Estimates only — never presented as guaranteed.
 */
export function UpcomingIncome({ events, today }: { events: DividendEvent[]; today: string }) {
  const active = events.filter((e) => !e.is_possible_duplicate);
  // Outstanding receivables = announced/expected/overdue, not already credited.
  const outstanding = active.filter(
    (e) =>
      !e.is_forecast &&
      e.event_type !== "credit" &&
      ["announced", "expected", "overdue"].includes(e.status) &&
      e.net_expected !== null
  );
  const overdue = outstanding.filter((e) => e.status === "overdue");
  const upcoming = outstanding.filter((e) => e.status !== "overdue");
  const forecasts = active.filter((e) => e.is_forecast && e.status === "forecasted");
  const needsEligibility = outstanding.filter(
    (e) => e.eligibility_status === "needs_confirmation" || e.eligibility_status === "unknown"
  );

  const expectedNet = sum(upcoming.map((e) => e.net_expected));
  const overdueNet = sum(overdue.map((e) => e.net_expected));
  const forecastLow = sum(forecasts.map((e) => e.net_low));
  const forecastHigh = sum(forecasts.map((e) => e.net_high));

  const nextWindow = upcoming
    .map((e) => e.estimated_payment_start ?? e.payment_date)
    .filter((d): d is string => !!d && d >= today)
    .sort()[0];

  // Sort the shortlist by soonest expected payment, overdue first.
  const shortlist = [...outstanding]
    .sort((a, b) => {
      if ((a.status === "overdue") !== (b.status === "overdue")) return a.status === "overdue" ? -1 : 1;
      return (a.estimated_payment_end ?? "9999").localeCompare(b.estimated_payment_end ?? "9999");
    })
    .slice(0, 5);

  const empty = outstanding.length === 0 && forecasts.length === 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between border-b border-border bg-muted/25">
        <div>
          <div className="flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Upcoming Income</CardTitle>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimated dividend receivables on your current holdings. Estimates only — not guaranteed.
          </p>
        </div>
        <Link href="/dividends" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
          Receivables <ArrowRight className="inline h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat label="Confirmed expected net" value={`PKR ${formatNumber(expectedNet, 0)}`} sub={`${upcoming.length} announced`} />
          <Stat
            label="Forecast net range"
            value={forecasts.length ? `PKR ${formatNumber(forecastLow, 0)}–${formatNumber(forecastHigh, 0)}` : "—"}
            sub={forecasts.length ? `${forecasts.length} forecast(s)` : "no forecasts"}
          />
          <Stat label="Overdue" value={`PKR ${formatNumber(overdueNet, 0)}`} sub={`${overdue.length} payment(s)`} tone={overdue.length ? "negative" : "neutral"} />
          <Stat label="Next window" value={nextWindow ?? "—"} sub={needsEligibility.length ? `${needsEligibility.length} need eligibility` : "eligibility ok"} tone={needsEligibility.length ? "warn" : "neutral"} />
        </div>

        {empty ? (
          <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            No confirmed or forecast receivables yet. Run a daily update to scan PSX filings for your holdings.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {shortlist.map((e) => (
              <Link
                key={e.id}
                href="/dividends"
                className="flex items-center justify-between gap-3 px-3 py-2 text-xs transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-semibold">{e.ticker}</span>
                  <Badge variant={e.status === "overdue" ? "red" : "green"}>{e.status}</Badge>
                  {(e.eligibility_status === "needs_confirmation" || e.eligibility_status === "unknown") && (
                    <Badge variant="amber">confirm eligibility</Badge>
                  )}
                  {e.face_value_assumed && <Badge variant="secondary">face value assumed</Badge>}
                </div>
                <div className="flex shrink-0 items-center gap-3 tabular-nums">
                  <span className="text-muted-foreground">
                    {e.payment_date ?? (e.estimated_payment_end ? `by ${e.estimated_payment_end}` : "—")}
                  </span>
                  <span className="font-semibold">PKR {formatNumber(e.net_expected, 0)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "negative" | "warn" | "neutral";
}) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone === "negative" && "text-red-600",
          tone === "warn" && "text-amber-600"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
