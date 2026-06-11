import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDividends, summarizeDividends } from "@/lib/dividends";
import { getTaxSettings } from "@/lib/dividends/tax";
import { normalizeEvent, isOverdue, type DividendEvent } from "@/lib/dividends/engine";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { DividendManager } from "@/components/dividend-form";
import { DividendReceivables } from "@/components/dividend-receivables";
import { ActionButton } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Download, RefreshCw, TrendingUp } from "lucide-react";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dividends, taxSettings, eventsRes] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDividends(supabase, user.id),
    getTaxSettings(supabase, user.id),
    supabase
      .from("dividend_events")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const events: DividendEvent[] = (eventsRes.data ?? []).map((r) => normalizeEvent(r as Record<string, unknown>));
  const dividendSummary = summarizeDividends(dividends);
  const receivedLedger = dividends.filter((d) => d.status === "received");

  const confirmedOpen = events.filter(
    (e) => !e.is_forecast && ["announced", "expected", "needs_review"].includes(e.status)
  );
  // Outstanding receivables for the "expected net" total: exclude already-credited
  // filings and flagged duplicates so nothing is double-counted.
  const outstanding = confirmedOpen.filter((e) => e.event_type !== "credit" && !e.is_possible_duplicate);
  const overdue = events.filter(
    (e) => !e.is_possible_duplicate && (e.status === "overdue" || isOverdue(e, today))
  );
  const forecasts = events.filter((e) => e.is_forecast && e.status === "forecasted");
  const needsEligibility = confirmedOpen.filter(
    (e) => e.eligibility_status === "needs_confirmation" || e.eligibility_status === "unknown"
  );

  const sum = (xs: (number | null)[]) => xs.reduce<number>((s, v) => s + (v ?? 0), 0);
  const confirmedGross = sum(outstanding.map((e) => e.gross_expected));
  const confirmedTax = sum(outstanding.map((e) => e.estimated_tax));
  const confirmedNet = sum(outstanding.map((e) => e.net_expected));
  const forecastNetLow = sum(forecasts.map((e) => e.net_low));
  const forecastNetHigh = sum(forecasts.map((e) => e.net_high));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dividend Receivables"
        description={`Confirmed announcements, forecasts and received income. Tax estimates use your ${taxSettings.taxpayer_status === "filer" ? "filer / ATL" : taxSettings.taxpayer_status} profile${taxSettings.dividend_tax_rate !== null ? ` at ${(taxSettings.dividend_tax_rate * 100).toFixed(0)}%` : ""} (${taxSettings.tax_year}). Estimates only — not tax or investment advice.`}
        actions={
          <>
            <ActionButton
              endpoint="/api/dividends/check"
              label={<><RefreshCw className="h-3.5 w-3.5" /> Check upcoming dividends</>}
              variant="default"
              size="sm"
            />
            <ActionButton
              endpoint="/api/dividends/forecast"
              label={<><TrendingUp className="h-3.5 w-3.5" /> Generate forecasts</>}
              variant="outline"
              size="sm"
            />
            <Link href="/api/export/dividends">
              <Button variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> Export CSV</Button>
            </Link>
          </>
        }
      />

      {!taxSettings.configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Tax profile not saved yet — calculations use the default filer/ATL assumptions (15%).{" "}
          <Link href="/settings" className="underline">Confirm your tax profile in Settings</Link>.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Confirmed expected net" value={`PKR ${formatNumber(confirmedNet, 0)}`} sub={`gross ${formatNumber(confirmedGross, 0)} − est. tax ${formatNumber(confirmedTax, 0)}`} />
        <StatCard
          label="Forecasted net range"
          value={forecasts.length > 0 ? `PKR ${formatNumber(forecastNetLow, 0)}–${formatNumber(forecastNetHigh, 0)}` : "—"}
          sub={forecasts.length > 0 ? `${forecasts.length} forecast(s) — not announced` : "no active forecasts"}
        />
        <StatCard label="Net received (all time)" value={`PKR ${formatNumber(dividendSummary.netReceived, 0)}`} sub={`${dividendSummary.receivedCount} payments`} />
        <StatCard
          label="Needs attention"
          value={String(overdue.length + needsEligibility.length)}
          sub={`${overdue.length} overdue · ${needsEligibility.length} eligibility unconfirmed`}
          tone={overdue.length > 0 ? "negative" : "neutral"}
        />
      </div>

      <DividendReceivables events={events} received={receivedLedger} showLowConfidence={false} />

      <Card>
        <CardHeader>
          <CardTitle>Manual dividend log</CardTitle>
          <CardDescription>
            Add or edit dividend records directly — imports and the receivables engine both write here, and manual entry always works.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DividendManager dividends={dividends} holdings={summary.holdings} />
        </CardContent>
      </Card>
    </div>
  );
}
