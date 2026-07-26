import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { HoldingsTable } from "@/components/features/holdings/holdings-table";
import { AddTransactionDialog } from "@/components/features/holdings/add-transaction-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { AsOf } from "@/components/shared/as-of";
import { ActionButton } from "@/components/ui/action-button";
import { formatMoney, formatNumber } from "@/lib/shared/format";
import { normalizeEnabledFeatures } from "@/lib/config/features";
import { Band } from "@/components/ui/band";
import { PanelHeader } from "@/components/ui/panel-header";
import { SectorWeightBar, SectorTreemap, BelowCostPlot } from "@/components/features/holdings/holdings-visuals";
import { Briefcase, Eye } from "lucide-react";

export const dynamic = "force-dynamic";

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

/** "Nine positions, seven sectors" — the design's editorial headline. */
function positionsHeadline(positions: number, sectors: number): string {
  const p = COUNT_WORDS[positions] ?? String(positions);
  const s = (COUNT_WORDS[sectors] ?? String(sectors)).toLowerCase();
  return `${p} position${positions === 1 ? "" : "s"}, ${s} sector${sectors === 1 ? "" : "s"}`;
}

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

  const latestPriceDate = summary.holdings.map((holding) => holding.price_date).filter(Boolean).sort().at(-1) ?? null;
  const unpriced = summary.holdingsCount - summary.pricedHoldings;
  const missingCompany = summary.holdings.filter((holding) => !holding.company_name?.trim()).length;
  const unclassified = summary.holdings.filter((holding) => !holding.sector?.trim()).length;

  const dayPnl = dailyPerformance.totalDayPnl;
  const belowCostRows = summary.holdings
    .filter((h) => h.latest_price !== null && h.avg_cost !== null && h.latest_price < h.avg_cost)
    .map((h) => ({ ticker: h.ticker, last: h.latest_price as number, avg: h.avg_cost as number }))
    .sort((a, b) => a.last / a.avg - b.last / b.avg);

  return (
    <div className="-mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-rule pb-5">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-clay" />
            <p className="eyebrow">Portfolio</p>
            <h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">
              {positionsHeadline(summary.holdingsCount, summary.sectorWeights.length)}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-muted">
              <AsOf date={latestPriceDate} label="Prices" />
              <span>· {summary.pricedHoldings} of {summary.holdingsCount} priced{unpriced ? ` · ${unpriced} valued at cost` : ""}</span>
            </p>
          </div>
        </div>

        {summary.holdings.length > 0 && (
          <>
            <p className="mt-5 max-w-(--measure) text-(length:--text-h3) leading-relaxed text-text-muted">
              Market value <strong className="figure font-semibold text-text-strong">{formatNumber(summary.totalValue, 0)}</strong> against a cost basis of{" "}
              <strong className="figure font-semibold text-text-strong">{formatNumber(summary.totalCost, 0)}</strong>. Unrealised{" "}
              <strong className={`figure font-semibold ${summary.unrealizedPl >= 0 ? "text-up" : "text-down"}`}>{formatNumber(summary.unrealizedPl, 0)}</strong>
              {dayPnl !== null && <>, with <strong className={`figure font-semibold ${dayPnl >= 0 ? "text-up" : "text-down"}`}>{formatNumber(dayPnl, 0)}</strong> of it today</>}.
            </p>
            <SectorWeightBar slices={summary.sectorWeights} total={summary.totalValue} />
          </>
        )}
      </Band>

      {summary.holdings.length === 0 ? (
        summary.hiddenHoldings.length > 0 ? null : (
          <Band tone="paper" rule="none" className="px-3 sm:px-4 md:px-(--gutter-page)">
            <EmptyState
              icon={Briefcase}
              title="No holdings yet"
              description="Add a manual buy transaction to start tracking positions and prices."
              action={isDemo ? undefined : <AddTransactionDialog label="Add transaction" variant="default" />}
            />
          </Band>
        )
      ) : (
        <>
          <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
            {(missingCompany > 0 || unclassified > 0 || unpriced > 0) && <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span><strong>Portfolio data</strong> · {[missingCompany && `${missingCompany} holding${missingCompany === 1 ? "" : "s"} missing company information`, unclassified && `${unclassified} unclassified sector${unclassified === 1 ? "" : "s"}`, unpriced && `${unpriced} unpriced position${unpriced === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>{companyEnrichmentEnabled && !isDemo && <ActionButton endpoint="/api/holdings/enrich" label={<>Review issues</>} variant="outline" size="sm" />}</div>}
            <HoldingsTable holdings={summary.holdings} summary={summary} dailyRows={dailyPerformance.rows.map((row) => ({ ticker: row.ticker, dayChangePct: row.dayChangePct, dayPnl: row.dayPnl }))} readOnly={isDemo} />
          </Band>

          <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <div>
                <PanelHeader eyebrow="Concentration" title="Weight by sector" />
                <SectorTreemap slices={summary.sectorWeights} total={summary.totalValue} />
              </div>
              <div>
                <PanelHeader eyebrow="Underwater" title="Cost against last price" />
                <BelowCostPlot rows={belowCostRows} />
              </div>
            </div>
          </Band>
        </>
      )}
      {summary.hiddenHoldings.length > 0 && (
        <Band tone="paper" rule="none" className="px-3 sm:px-4 md:px-(--gutter-page)">
          <PanelHeader
            eyebrow="Excluded"
            title="Hidden holdings"
            aside={<span className="figure text-xs text-text-muted">{summary.hiddenHoldings.length}</span>}
          />
          <p className="mt-2 text-xs text-text-muted">Kept in your ledger but excluded from totals, performance, dividends and Copilot.</p>
          <div className="ledger mt-3">
            {summary.hiddenHoldings.map((h) => (
              <div key={h.ticker} className="ledger-row flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-text-strong">{h.ticker}</span>
                  {h.company_name && <span className="text-xs text-text-muted">{h.company_name}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="figure text-xs text-text-muted">{formatNumber(h.quantity, 0)} shares · cost {formatMoney(h.total_cost)}</span>
                  {!isDemo && <ActionButton endpoint={`/api/holdings/${h.ticker}`} method="PATCH" body={{ hidden: false }} label={<><Eye className="h-3.5 w-3.5" /> Unhide</>} variant="outline" size="sm" />}
                </div>
              </div>
            ))}
          </div>
        </Band>
      )}
    </div>
  );
}

