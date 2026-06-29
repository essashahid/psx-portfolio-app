import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDividends } from "@/lib/dividends";
import { getTaxSettings } from "@/lib/dividends/tax";
import { normalizeEvent, type DividendEvent } from "@/lib/dividends/engine";
import { DividendManager } from "@/components/dividend-form";
import { DividendIncomeWorkspace } from "@/components/dividend-income-workspace";
import { ActionButton } from "@/components/action-button";
import { ChevronDown, Download, RefreshCw, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DividendsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dividends, taxSettings, eventsRes] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDividends(supabase, user.id),
    getTaxSettings(supabase, user.id),
    supabase.from("dividend_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(300),
  ]);

  const asOf = new Date().toISOString().slice(0, 10);
  const events: DividendEvent[] = (eventsRes.data ?? []).map((row) => normalizeEvent(row as Record<string, unknown>));
  const taxRate = taxSettings.dividend_tax_rate !== null ? `${(taxSettings.dividend_tax_rate * 100).toFixed(0)}%` : "Not configured";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <p className="eyebrow">Income</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dividend Income</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Track received income, upcoming announcements, tax deductions and manually recorded dividends.</p>
          <p className="mt-3 text-xs text-muted-foreground">Tax profile: {taxSettings.taxpayer_status === "filer" ? "ATL filer" : taxSettings.taxpayer_status} · Estimated rate {taxRate} · {taxSettings.configured ? `Tax year ${taxSettings.tax_year}` : "Profile needs confirmation"}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <DividendManager dividends={dividends} holdings={summary.holdings} triggerOnly />
          <ActionButton endpoint="/api/dividends/check" label={<><RefreshCw className="h-3.5 w-3.5" /> Check announcements</>} variant="outline" size="sm" />
          <details className="relative">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent md:h-8"><span>More</span><ChevronDown className="h-3.5 w-3.5" /></summary>
            <div className="absolute right-0 z-20 mt-1 flex w-52 flex-col gap-1 rounded-md border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
              <ActionButton endpoint="/api/dividends/forecast" label={<><TrendingUp className="h-3.5 w-3.5" /> Estimate future dividends</>} variant="ghost" size="sm" className="w-full justify-start px-2.5" />
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download, not a page navigation */}
              <a href="/api/export/dividends" className="rounded px-2.5 py-2 text-xs hover:bg-muted"><Download className="mr-1.5 inline h-3.5 w-3.5" /> Export CSV</a>
            </div>
          </details>
        </div>
      </header>

      {!taxSettings.configured && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Tax profile is not saved. Amounts use the current default assumptions.</p>}

      <DividendIncomeWorkspace dividends={dividends} events={events} holdings={summary.holdings} asOf={asOf} />
    </div>
  );
}
