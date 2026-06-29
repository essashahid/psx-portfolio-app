import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { HoldingsTable } from "@/components/holdings-table";
import { AddTransactionDialog } from "@/components/add-transaction-dialog";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { formatMoney, formatNumber, formatSignedPct } from "@/lib/utils";
import { normalizeEnabledFeatures } from "@/lib/features";
import { Briefcase, ChevronDown, Download, RefreshCw, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dailyPerformance, profileRes] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDailyHoldingPerformance(supabase, user.id),
    supabase.from("profiles").select("enabled_features, demo_mode").eq("id", user.id).maybeSingle(),
  ]);
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const enabledFeatures = normalizeEnabledFeatures(profileRes.data?.enabled_features);
  const companyEnrichmentEnabled = enabledFeatures.includes("company_enrichment");
  const companyReportsEnabled = enabledFeatures.includes("company_reports");

  const latestPriceDate = summary.holdings.map((holding) => holding.price_date).filter(Boolean).sort().at(-1) ?? null;
  const unpriced = summary.holdingsCount - summary.pricedHoldings;
  const belowCost = summary.holdings.filter((holding) => (holding.unrealized_pl ?? 0) < 0).length;
  const missingCompany = summary.holdings.filter((holding) => !holding.company_name?.trim()).length;
  const unclassified = summary.holdings.filter((holding) => !holding.sector?.trim()).length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Holdings</h1>
          <p className="mt-1 text-xs text-muted-foreground">{formatNumber(summary.holdingsCount, 0)} positions · {latestPriceDate ? `Prices updated ${latestPriceDate}` : "No prices available"} · {summary.pricedHoldings} of {summary.holdingsCount} priced{unpriced ? ` · ${unpriced} valued at cost` : ""}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {!isDemo && <AddTransactionDialog variant="default" />}
          {!isDemo && <ActionButton endpoint="/api/prices" body={{ refresh: true }} label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh prices</>} variant="outline" size="sm" />}
          <details className="relative">
            <summary className="inline-flex h-10 cursor-pointer list-none items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-accent md:h-8"><span>More</span><ChevronDown className="h-3.5 w-3.5" /></summary>
            <div className="absolute right-0 z-10 mt-1 flex w-52 flex-col gap-1 rounded-md border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
              <Link href="/dividends" className="rounded px-2.5 py-2 text-xs hover:bg-muted">Record dividend</Link>
              {companyEnrichmentEnabled && !isDemo && (
                <ActionButton endpoint="/api/holdings/enrich" label={<><Sparkles className="h-3.5 w-3.5" /> Update company details</>} variant="ghost" size="sm" className="w-full justify-start px-2.5" />
              )}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download, not a page navigation */}
              <a href="/api/export/holdings" className="rounded px-2.5 py-2 text-xs hover:bg-muted"><Download className="mr-1.5 inline h-3.5 w-3.5" /> Export CSV</a>
            </div>
          </details>
        </div>
      </header>
      {summary.holdings.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No holdings yet"
          description="Add a manual buy transaction to start tracking positions and prices."
          action={isDemo ? undefined : <AddTransactionDialog label="Add transaction" variant="default" />}
        />
      ) : (
        <>
          <section>
            <div className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Market value" value={formatMoney(summary.totalValue)} sub={`${summary.pricedHoldings} priced positions`} />
              <Metric label="Cost basis" value={formatMoney(summary.totalCost)} />
              <Metric label="Unrealised P/L" value={formatMoney(summary.unrealizedPl)} sub={formatSignedPct(summary.unrealizedPlPct)} tone={summary.unrealizedPl > 0 ? "positive" : summary.unrealizedPl < 0 ? "negative" : "flat"} />
              <Metric label="Dividend income" value={formatMoney(summary.dividendIncome)} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{summary.holdingsCount} holdings · Largest position: {summary.largestHolding ? `${summary.largestHolding.ticker} ${summary.largestHolding.weight?.toFixed(1)}%` : "—"} · {belowCost} position{belowCost === 1 ? "" : "s"} below cost</p>
          </section>
          {(missingCompany > 0 || unclassified > 0 || unpriced > 0) && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span><strong>Portfolio data</strong> · {[missingCompany && `${missingCompany} holding${missingCompany === 1 ? "" : "s"} missing company information`, unclassified && `${unclassified} unclassified sector${unclassified === 1 ? "" : "s"}`, unpriced && `${unpriced} unpriced position${unpriced === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>{companyEnrichmentEnabled && !isDemo && <ActionButton endpoint="/api/holdings/enrich" label={<>Review issues</>} variant="outline" size="sm" />}</div>}
          <HoldingsTable holdings={summary.holdings} summary={summary} dailyRows={dailyPerformance.rows.map((row) => ({ ticker: row.ticker, dayChangePct: row.dayChangePct, dayPnl: row.dayPnl }))} companyReportsEnabled={companyReportsEnabled && !isDemo} companyEnrichmentEnabled={companyEnrichmentEnabled && !isDemo} readOnly={isDemo} />
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" | "flat" }) {
  return <div className="border-b border-border p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : ""}`}>{value}</p>{sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}</div>;
}
