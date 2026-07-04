import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDividends } from "@/lib/dividends";
import { getTaxSettings } from "@/lib/dividends/tax";
import { normalizeEvent, isOverdue, type DividendEvent } from "@/lib/dividends/engine";
import { DividendManager } from "@/components/dividend-form";
import { DividendIncomeWorkspace } from "@/components/dividend-income-workspace";
import { DividendTrajectory, DividendYieldTable, TaxYearStatement, AwaitingPayment } from "@/components/dividend-analytics";
import { ActionButton } from "@/components/action-button";
import { ChevronDown, Download, RefreshCw, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dividends, taxSettings, eventsRes, profileRes] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDividends(supabase, user.id),
    getTaxSettings(supabase, user.id),
    supabase.from("dividend_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(300),
    supabase.from("profiles").select("demo_mode").eq("id", user.id).maybeSingle(),
  ]);
  const isDemo = Boolean(profileRes.data?.demo_mode);

  const asOf = new Date().toISOString().slice(0, 10);
  const events: DividendEvent[] = (eventsRes.data ?? []).map((row) => normalizeEvent(row as Record<string, unknown>));
  const taxRate = taxSettings.dividend_tax_rate !== null ? `${(taxSettings.dividend_tax_rate * 100).toFixed(0)}%` : "Not configured";

  // Announced/expected payouts whose payment window has already passed. Silence
  // otherwise looks the same as "nothing due", so surface these for follow-up.
  const awaiting = events
    .filter((event) => isOverdue(event, asOf) && !event.is_possible_duplicate)
    .map((event) => {
      const dueDate = event.payment_date ?? event.estimated_payment_end;
      const daysOverdue = dueDate ? Math.max(0, Math.round((new Date(asOf).getTime() - new Date(dueDate).getTime()) / 86400_000)) : 0;
      return { ticker: event.ticker, company_name: event.company_name, net_expected: event.net_expected, dueDate, daysOverdue };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 12);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="eyebrow">Income</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dividend Income</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Track received income, upcoming announcements, tax deductions and manually recorded dividends.</p>
          {!isDemo && <p className="mt-3 text-xs text-muted-foreground">Tax profile: {taxSettings.taxpayer_status === "filer" ? "ATL filer" : taxSettings.taxpayer_status} · Estimated rate {taxRate} · {taxSettings.configured ? `Tax year ${taxSettings.tax_year}` : "Profile needs confirmation"}</p>}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {!isDemo && <DividendManager dividends={dividends} holdings={summary.holdings} triggerOnly />}
          {!isDemo && <ActionButton endpoint="/api/dividends/check" label={<><RefreshCw className="h-3.5 w-3.5" /> Check announcements</>} variant="outline" size="sm" />}
          <details className="relative">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent md:h-8"><span>More</span><ChevronDown className="h-3.5 w-3.5" /></summary>
            <div className="absolute right-0 z-20 mt-1 flex w-52 flex-col gap-1 rounded-md border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
              {!isDemo && <ActionButton endpoint="/api/dividends/forecast" label={<><TrendingUp className="h-3.5 w-3.5" /> Estimate future dividends</>} variant="ghost" size="sm" className="w-full justify-start px-2.5" />}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download, not a page navigation */}
              <a href="/api/export/dividends" className="rounded px-2.5 py-2 text-xs hover:bg-muted"><Download className="mr-1.5 inline h-3.5 w-3.5" /> Export CSV</a>
            </div>
          </details>
        </div>
      </header>

      {!taxSettings.configured && !isDemo && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Tax profile is not saved. Amounts use the current default assumptions.</p>}

      <DividendIncomeWorkspace dividends={dividends} events={events} holdings={summary.holdings} asOf={asOf} readOnly={isDemo} />

      <AwaitingPayment events={awaiting} />

      <section className="border-t border-border pt-5">
        <h2 className="text-base font-semibold">Income trajectory</h2>
        <p className="mt-1 text-xs text-muted-foreground">Net dividend income by calendar year, with the current and next year&apos;s forecast and confirmed-but-unpaid income extended on top.</p>
        <div className="mt-4">
          <DividendTrajectory dividends={dividends} events={events} />
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <h2 className="text-base font-semibold">Yield by holding</h2>
        <p className="mt-1 text-xs text-muted-foreground">Trailing-12-month income against what each position cost and what it is worth today.</p>
        <div className="mt-4">
          <DividendYieldTable dividends={dividends} holdings={summary.holdings} asOf={asOf} />
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <h2 className="text-base font-semibold">Tax-year statement</h2>
        <p className="mt-1 text-xs text-muted-foreground">Gross, withheld and net dividend income per holding for a Pakistan tax year (1 July to 30 June).</p>
        <div className="mt-4">
          <TaxYearStatement dividends={dividends} defaultYear={taxSettings.tax_year ?? null} />
        </div>
      </section>
    </div>
  );
}
