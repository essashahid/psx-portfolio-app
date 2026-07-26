/* eslint-disable @next/next/no-html-link-for-pages -- export endpoint returns a file, not a page */
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPerformanceAnalytics } from "@/lib/engine/performance";
import { buildLedgerRows, type LedgerCashInput, type LedgerTxnInput } from "@/lib/engine/ledger-view";
import { getPortfolio } from "@/lib/portfolio/positions";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionButton } from "@/components/ui/action-button";
import { LedgerTable } from "@/components/features/performance/ledger-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { CostFrictionBars } from "@/components/shared/charts-lazy";
import { BridgeBars } from "@/components/features/performance/bridge-bars";
import { BenchmarkGrowthChart } from "@/components/features/performance/benchmark-growth-chart";
import { cn, formatMoney, formatNumber, formatSignedPct } from "@/lib/shared/format";
import {
  AlertTriangle,
  ChevronDown,
  Download,
  RefreshCw,
  TrendingUp,
  Upload,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [analytics, portfolio, txnsRes, cashRes] = await Promise.all([
    getPerformanceAnalytics(supabase, user.id),
    getPortfolio(supabase, user.id),
    supabase
      .from("transactions")
      .select("id, trade_date, type, ticker, quantity, price, commission, tax, net_amount, notes")
      .eq("user_id", user.id)
      .order("trade_date", { ascending: true }),
    supabase
      .from("cash_movements")
      .select("id, movement_date, type, amount, description")
      .eq("user_id", user.id)
      .order("movement_date", { ascending: true }),
  ]);

  if (!analytics) {
    return (
      <div className="space-y-5">
        <header>
          <span className="mb-3.5 block h-0.75 w-11 bg-indigo" />
          <p className="eyebrow">Portfolio</p>
          <h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Performance</h1>
        </header>
        <EmptyState
          icon={TrendingUp}
          title="No ledger found"
          description="Import the full AKD Statement of Account to calculate ledger-backed return, cash flows and trade costs."
          action={
            <Link href="/import">
              <Button>
                <Upload className="h-4 w-4" /> Import statement
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { returns, friction, byYear, sales, checkpoints } = analytics;
  const platformQty = new Map(portfolio.holdings.map((h) => [h.ticker, h.quantity]));
  const platformHasHoldings = portfolio.holdingsCount > 0;
  const quantityRows = analytics.quantityReconciliation.map((row) => {
    const currentPlatformQuantity = platformQty.get(row.ticker) ?? null;
    const difference =
      currentPlatformQuantity === null ? null : currentPlatformQuantity - row.expectedQuantity;
    return {
      ...row,
      currentPlatformQuantity,
      difference,
      status:
        currentPlatformQuantity === null
          ? ("Platform quantity unavailable" as const)
          : Math.abs(difference ?? 0) < 0.0001
            ? ("Reconciled" as const)
            : ("Difference" as const),
    };
  });
  const platformDifferences = quantityRows.filter((row) => row.status === "Difference");
  const expectedTotalQuantity = quantityRows.reduce((sum, row) => sum + row.expectedQuantity, 0);
  const platformTotalQuantity = platformHasHoldings
    ? quantityRows.reduce((sum, row) => sum + (row.currentPlatformQuantity ?? 0), 0)
    : null;
  const usePlatformCurrent =
    platformHasHoldings &&
    platformDifferences.length === 0 &&
    platformTotalQuantity === expectedTotalQuantity &&
    portfolio.pricedHoldings > 0;
  const currentWorth = usePlatformCurrent ? portfolio.totalValue + portfolio.cashBalance : returns.netWorth;
  const currentUpdate = usePlatformCurrent ? currentWorth - returns.netWorth : 0;
  const bridge = usePlatformCurrent && Math.abs(currentUpdate) >= 0.01
    ? [
        ...analytics.wealthBridge.filter((row) => row.kind !== "end"),
        {
          label: "Current price/cash update",
          value: currentUpdate,
          kind: currentUpdate >= 0 ? ("increase" as const) : ("decrease" as const),
          includedInReconciliation: true,
          note: "Difference between adjusted AKD endpoint and current platform valuation",
        },
        {
          label: "Current net worth",
          value: currentWorth,
          kind: "end" as const,
          includedInReconciliation: true,
          note: "Platform market value plus platform cash",
        },
      ]
    : analytics.wealthBridge;
  const netGain = currentWorth - returns.totalDeposited;
  const bridgeDifference = usePlatformCurrent ? 0 : checkpoints.wealthBridgeDifference;
  const transactions = (txnsRes.data ?? []).map((t) => ({
    ...t,
    quantity: t.quantity !== null ? Number(t.quantity) : null,
    price: t.price !== null ? Number(t.price) : null,
    commission: t.commission !== null ? Number(t.commission) : null,
    tax: t.tax !== null ? Number(t.tax) : null,
    net_amount: t.net_amount !== null ? Number(t.net_amount) : null,
  })) as (LedgerTxnInput & { commission?: number | null; tax?: number | null })[];
  const cashMovements = (cashRes.data ?? []).map((c) => ({
    ...c,
    amount: Number(c.amount),
  })) as LedgerCashInput[];
  const ledger = buildLedgerRows(transactions, cashMovements);

  const sourceComplete = analytics.source.status === "complete" || analytics.source.status === "reconciled";

  return (
    <div className="pb-6">
      <div className="-mx-3 border-b border-rule px-3 pb-7 pt-1 sm:-mx-4 sm:px-4 md:-mx-8 md:px-8" style={{ background: "color-mix(in oklab, var(--indigo-4) 58%, var(--surface-sunken))" }}>
      <header className="pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-indigo" />
            <p className="eyebrow">Portfolio</p>
            <h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Performance</h1>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <ActionButton
              endpoint="/api/portfolio/rebuild"
              label={
                <>
                  <RefreshCw className="h-3.5 w-3.5" /> Rebuild
                </>
              }
              variant="outline"
              size="sm"
            />
            <details className="relative">
              <summary className="inline-flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium md:h-8">
                More <ChevronDown className="h-3.5 w-3.5" />
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
                <a href="/api/export/holdings" className="block rounded px-2 py-1.5 text-xs hover:bg-muted">
                  <Download className="mr-1 inline h-3.5 w-3.5" />Export holdings
                </a>
              </div>
            </details>
          </div>
        </div>
        {!sourceComplete && (
          <div className="mt-4 flex gap-2 border-l-2 border-amber-500 pl-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Full AKD statement data is unavailable. This page is intentionally marked incomplete instead of
              presenting the old partial counts as final performance.
            </p>
          </div>
        )}
      </header>

      {/* Design hero: XIRR as the page's display numeral, flanked by net gain
          and net worth. The prose verdict follows with the full reasoning. */}
      <section className="flex flex-wrap items-end gap-12 border-t border-rule pt-6">
        <div>
          <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Money-weighted return · XIRR</p>
          <p className="figure mt-2 text-(length:--text-display) font-semibold leading-none tracking-editorial text-text-strong">
            {returns.xirrPct !== null ? `${returns.xirrPct >= 0 ? "+" : ""}${returns.xirrPct}%` : "—"}
          </p>
          <p className="mt-2.5 text-(length:--text-2xs) text-text-faint">
            a year{returns.startDate && returns.endDate ? ` over ${returns.startDate} to ${returns.endDate}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-11 pb-1">
          <div className={cn("border-l-[3px] pl-5", netGain >= 0 ? "border-up" : "border-down")}>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Net investment gain</p>
            <p className={cn("figure mt-1.5 text-(length:--text-h1) font-semibold", netGain >= 0 ? "text-up" : "text-down")}>{formatMoney(netGain)}</p>
            <p className="figure mt-1 text-(length:--text-2xs) text-text-faint">
              {formatSignedPct(returns.totalDeposited ? (netGain / returns.totalDeposited) * 100 : null)} on {formatMoney(returns.totalDeposited)} of capital
            </p>
          </div>
          <div>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Current net worth</p>
            <p className="figure mt-1.5 text-(length:--text-h1) font-medium text-text-strong">{formatMoney(currentWorth)}</p>
            <p className="mt-1 text-(length:--text-2xs) text-text-faint">holdings plus broker cash</p>
          </div>
        </div>
      </section>
      </div>

      <div className="space-y-8 pt-8">

      {analytics.benchmark && analytics.benchmark.series.length >= 2 && (
        <section className="dot-grid -mx-3 border-b border-rule px-3 pb-8 sm:-mx-4 sm:px-4 md:-mx-8 md:px-8">
          <p className="eyebrow">Growth of invested capital</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Your contribution schedule, four ways</h2>
          <div className="mt-5">
            <BenchmarkGrowthChart data={analytics.benchmark.series} />
          </div>
        </section>
      )}

      <section className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Wealth creation bridge</p>
            <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">From capital in to net worth</h2>
          </div>
          <div className={cn("text-xs", Math.abs(bridgeDifference) < 0.01 ? "text-up" : "text-down")}>
            {Math.abs(bridgeDifference) < 0.01
              ? "Bridge reconciles"
              : `Unreconciled difference: ${formatMoney(bridgeDifference)}`}
          </div>
        </div>
        <div className="mt-4">
          <BridgeBars rows={bridge} />
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <p className="eyebrow">Performance against benchmarks</p>
        <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">How each comparison is built</h2>
        <div className="mt-6 grid gap-y-8 sm:grid-cols-3 sm:gap-y-0">
          <div className="border-l-[3px] border-up pl-5 sm:pr-7">
            <p className="text-sm font-semibold text-text-strong">Against the KSE-100</p>
            <p className={cn("figure mt-2.5 text-(length:--text-h1) font-semibold", analytics.benchmark && analytics.benchmark.excessVsKse100 < 0 ? "text-down" : "text-up")}>
              {analytics.benchmark ? `${analytics.benchmark.excessVsKse100 < 0 ? "−" : "+"}${formatNumber(Math.abs(analytics.benchmark.excessVsKse100), 0)}` : "—"}
            </p>
            {!analytics.benchmark && <p className="mt-2 text-xs text-text-muted">{analytics.benchmarkStatus.kse100.reason ?? "Requires the benchmark series."}</p>}
          </div>
          <div className="border-l-[3px] border-saffron pl-5 sm:pr-7">
            <p className="text-sm font-semibold text-text-strong">Against inflation</p>
            <p className={cn("figure mt-2.5 text-(length:--text-h1) font-semibold", analytics.benchmark && analytics.benchmark.excessVsInflation < 0 ? "text-down" : "text-up")}>
              {analytics.benchmark ? `${analytics.benchmark.excessVsInflation < 0 ? "−" : "+"}${formatNumber(Math.abs(analytics.benchmark.excessVsInflation), 0)}` : "—"}
            </p>
            {!analytics.benchmark && <p className="mt-2 text-xs text-text-muted">{analytics.benchmarkStatus.inflation.reason ?? "Requires Pakistan CPI history."}</p>}
          </div>
          <div className="border-l-[3px] border-down pl-5">
            <p className="text-sm font-semibold text-text-strong">Worst drawdown</p>
            <p className="figure mt-2.5 text-(length:--text-h1) font-semibold text-down">
              {analytics.benchmark?.maxDrawdownPct !== null && analytics.benchmark?.maxDrawdownPct !== undefined ? `${analytics.benchmark.maxDrawdownPct}%` : "—"}
            </p>
            {analytics.benchmark?.maxDrawdownPct == null && <p className="mt-2 text-xs text-text-muted">{analytics.benchmarkStatus.drawdown.reason ?? "Requires a complete value series."}</p>}
          </div>
        </div>
      </section>

      <Tabs
        initial="realised"
        tabs={[
          {
            id: "realised",
            label: "Realised Trades",
            content: <RealisedTable sales={sales} />,
          },
          {
            id: "years",
            label: "By Year",
            content: <YearTable rows={byYear} />,
          },
          {
            id: "positions",
            label: "Position Build-Up",
            content: <PositionTable rows={analytics.positionBuild} />,
          },
          {
            id: "costs",
            label: "Costs",
            content: <CostWorkspace friction={friction} />,
          },
          {
            id: "audit",
            label: "Audit",
            content: (
              <AuditWorkspace
                cashflows={returns.cashflows}
                events={analytics.normalizedEvents}
                dividendIncome={portfolio.dividendIncome}
              />
            ),
          },
        ]}
      />


      <LedgerTable rows={ledger.rows} transactions={transactions} cashMovements={cashMovements} />
      </div>
    </div>
  );
}


function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}



function RealisedTable({ sales }: { sales: NonNullable<Awaited<ReturnType<typeof getPerformanceAnalytics>>>["sales"] }) {
  return (
    <section className="border-t border-border pt-5">
      <h2 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Realised performance</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[65rem] text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">Ticker</th>
              <th className="px-2 py-2">Sale date</th>
              <th className="px-2 py-2 text-right">Qty sold</th>
              <th className="px-2 py-2 text-right">Cost allocated</th>
              <th className="px-2 py-2 text-right">Gross proceeds</th>
              <th className="px-2 py-2 text-right">Sale fees</th>
              <th className="px-2 py-2 text-right">Net proceeds</th>
              <th className="px-2 py-2 text-right">Realised P/L</th>
              <th className="px-2 py-2 text-right">Return</th>
              <th className="px-2 py-2 text-right">Avg hold</th>
              <th className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale, index) => (
              <tr key={`${sale.ticker}-${sale.date}-${index}`} className="border-b border-border last:border-0 align-top">
                <td className="py-2 pr-4 font-semibold">
                  <details>
                    <summary className="cursor-pointer list-none">{sale.ticker}</summary>
                    <p className="mt-2 max-w-[16.25rem] text-[11px] leading-snug text-muted-foreground">
                      {sale.formula}. Source entries: {sale.sourceEntryNos.join(", ")}.
                    </p>
                  </details>
                </td>
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{sale.date ?? "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(sale.quantity, 0)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(sale.costOut)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(sale.grossProceeds)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(sale.saleFees)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(sale.proceeds)}</td>
                <td className={cn("px-2 py-2 text-right font-medium tabular-nums", sale.realized >= 0 ? "text-up" : "text-down")}>{formatMoney(sale.realized)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatSignedPct(sale.realizedReturnPct)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{sale.averageHoldingDays !== null ? `${formatNumber(sale.averageHoldingDays, 0)}d` : "—"}</td>
                <td className="px-2 py-2"><Badge variant={sale.status === "Closed" ? "secondary" : "blue"}>{sale.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function YearTable({ rows }: { rows: NonNullable<Awaited<ReturnType<typeof getPerformanceAnalytics>>>["byYear"] }) {
  return (
    <section className="border-t border-border pt-5">
      <h2 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Performance by year</h2>
      <p className="mt-1 text-xs text-muted-foreground">Gross purchases are separate from external contributions. Benchmark and real-return columns stay unavailable until their series exist.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[78.75rem] text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">Year</th>
              <th className="px-2 py-2 text-right">Contributions</th>
              <th className="px-2 py-2 text-right">External acquisitions</th>
              <th className="px-2 py-2 text-right">Gross purchases</th>
              <th className="px-2 py-2 text-right">Gross sales</th>
              <th className="px-2 py-2 text-right">Net deployed</th>
              <th className="px-2 py-2 text-right">Realised P/L</th>
              <th className="px-2 py-2 text-right">Trading charges</th>
              <th className="px-2 py-2 text-right">Account</th>
              <th className="px-2 py-2 text-right">CGT/tariffs</th>
              <th className="px-2 py-2 text-right">Buy lines/orders</th>
              <th className="px-2 py-2 text-right">Sell lines/orders</th>
              <th className="px-2 py-2 text-right">Ending net worth</th>
              <th className="px-2 py-2 text-right">KSE-100</th>
              <th className="px-2 py-2 text-right">Real return</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.year} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 font-semibold">{row.year}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.deposits)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.manualExternalAcquisitions)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.buys)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.sells)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.netCapitalDeployed)}</td>
                <td className={cn("px-2 py-2 text-right tabular-nums", row.realizedPl >= 0 ? "text-up" : "text-down")}>{formatMoney(row.realizedPl)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.tradingCharges)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.accountCharges)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.cgtTariffs)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.buyLines}/{row.buyOrders}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.sellLines}/{row.sellOrders}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.endingNetWorth)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {row.kse100MatchedResult !== null ? (
                    formatMoney(row.kse100MatchedResult)
                  ) : (
                    <span className="text-muted-foreground">Unavailable</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {row.realReturnAfterInflation !== null ? (
                    formatSignedPct(row.realReturnAfterInflation)
                  ) : (
                    <span className="text-muted-foreground">Unavailable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionTable({ rows }: { rows: NonNullable<Awaited<ReturnType<typeof getPerformanceAnalytics>>>["positionBuild"] }) {
  return (
    <section className="border-t border-border pt-5">
      <h2 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Position build-up analysis</h2>
      <p className="mt-1 text-xs text-muted-foreground">Current holdings are aggregated under weighted-average accounting; purchase lots are not shown as separate holdings. Per-holding XIRR is the money-weighted annual return of each position&apos;s own buys, sells and current value; it excludes dividends.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[80rem] text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">Ticker</th>
              <th className="px-2 py-2">First</th>
              <th className="px-2 py-2">Latest</th>
              <th className="px-2 py-2 text-right">Purchases</th>
              <th className="px-2 py-2 text-right">Qty acquired</th>
              <th className="px-2 py-2 text-right">Qty sold</th>
              <th className="px-2 py-2 text-right">Corp action qty</th>
              <th className="px-2 py-2 text-right">Current qty</th>
              <th className="px-2 py-2 text-right">Low/high price</th>
              <th className="px-2 py-2 text-right">Avg cost</th>
              <th className="px-2 py-2 text-right">Current price</th>
              <th className="px-2 py-2 text-right">Avg age</th>
              <th className="px-2 py-2 text-right">Invested</th>
              <th className="px-2 py-2 text-right">Current value</th>
              <th className="px-2 py-2 text-right">Unrealised</th>
              <th className="px-2 py-2 text-right">XIRR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ticker} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 font-semibold">{row.ticker}</td>
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{row.firstAcquisitionDate ?? "—"}</td>
                <td className="px-2 py-2 tabular-nums text-muted-foreground">{row.latestAcquisitionDate ?? "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.purchaseCount}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.totalQuantityAcquired, 0)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.quantitySold, 0)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.corporateActionQuantity, 0)}</td>
                <td className="px-2 py-2 text-right tabular-nums font-medium">{formatNumber(row.currentQuantity, 0)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.lowestPurchasePrice, 2)} / {formatNumber(row.highestPurchasePrice, 2)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.weightedAverageCost, 2)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.currentPrice, 2)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.averageHoldingAgeDays !== null ? `${formatNumber(row.averageHoldingAgeDays, 0)}d` : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.amountInvested)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.currentValue)}</td>
                <td className={cn("px-2 py-2 text-right tabular-nums", (row.unrealizedPl ?? 0) >= 0 ? "text-up" : "text-down")}>{formatMoney(row.unrealizedPl)}</td>
                <td className={cn("px-2 py-2 text-right tabular-nums", row.xirrPct === null ? "text-muted-foreground" : row.xirrPct >= 0 ? "text-up" : "text-down")}>{row.xirrPct !== null ? `${row.xirrPct}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CostWorkspace({ friction }: { friction: NonNullable<Awaited<ReturnType<typeof getPerformanceAnalytics>>>["friction"] }) {
  return (
    <section className="border-t border-border pt-5">
      <h2 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Cost and friction analysis</h2>
      <p className="mt-1 text-xs text-muted-foreground">Unknown manual-trade fees are labelled unavailable, not treated as zero.</p>
      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <CostFrictionBars data={friction.byCategory} />
        <div>
          <div className="grid grid-cols-2 gap-4 border-b border-border pb-4 text-sm">
            <Mini label="Trading costs" value={formatMoney(friction.tradeFeesTotal)} />
            <Mini label="Avg fee/order" value={formatMoney(friction.averageFeePerOrder)} />
            <Mini label="Gross traded value" value={formatMoney(friction.grossTradedValue)} />
            <Mini label="Fee rate" value={friction.feePctGrossTraded !== null ? `${friction.feePctGrossTraded}%` : "—"} />
          </div>
          <h3 className="mt-4 text-sm font-semibold">Order-size analysis</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[35rem] text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4">Band</th>
                  <th className="px-2 py-2 text-right">Orders</th>
                  <th className="px-2 py-2 text-right">Gross value</th>
                  <th className="px-2 py-2 text-right">Avg order</th>
                  <th className="px-2 py-2 text-right">Total fees</th>
                  <th className="px-2 py-2 text-right">Fee rate</th>
                </tr>
              </thead>
              <tbody>
                {friction.bySize.map((row) => (
                  <tr key={row.bucket} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 font-medium">{row.bucket}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.trades}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.grossTradedValue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.avgGross)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.totalFees)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.avgFeePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="mt-4 text-sm font-semibold">Highest-cost orders</h3>
          <div className="mt-2 space-y-2 text-xs">
            {friction.highestCostOrders.map((row) => (
              <div key={`${row.date}-${row.orderNo}-${row.tickers}`} className="flex items-center justify-between gap-3 border-b border-border pb-2">
                <span><strong>{row.side}</strong> #{row.orderNo} · {row.tickers} · {row.date ?? "—"}</span>
                <span className="tabular-nums text-muted-foreground">{formatMoney(row.fees)} · {row.feePct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditWorkspace({
  cashflows,
  events,
  dividendIncome,
}: {
  cashflows: NonNullable<Awaited<ReturnType<typeof getPerformanceAnalytics>>>["returns"]["cashflows"];
  events: NonNullable<Awaited<ReturnType<typeof getPerformanceAnalytics>>>["normalizedEvents"];
  dividendIncome: number;
}) {
  return (
    <section className="border-t border-border pt-5">
      <h2 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Audit and XIRR inputs</h2>
      <details className="mt-3 border-l border-border pl-3">
        <summary className="cursor-pointer text-sm font-medium">View XIRR cash flows</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[35rem] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Date</th>
                <th className="px-2 py-2">Label</th>
                <th className="px-2 py-2">Source</th>
                <th className="px-2 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {cashflows.map((row, index) => (
                <tr key={`${row.date}-${index}`} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 tabular-nums">{row.date}</td>
                  <td className="px-2 py-2">{row.label ?? "Cash flow"}</td>
                  <td className="px-2 py-2 text-muted-foreground">{row.source ?? "—"}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", row.amount < 0 ? "text-down" : "text-up")}>{formatMoney(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details className="mt-4 border-l border-border pl-3">
        <summary className="cursor-pointer text-sm font-medium">Normalized event table</summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Includes broker entries, confirmed manual/corporate adjustments and original narrations. Dividend module linked amount: {formatMoney(dividendIncome)}.
        </p>
        <div className="mt-3 max-h-[35rem] overflow-auto">
          <table className="w-full min-w-[61.25rem] text-xs">
            <thead>
              <tr className="sticky top-0 border-b border-border bg-background text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Event</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Ticker</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Gross</th>
                <th className="px-2 py-2 text-right">Net cash</th>
                <th className="px-2 py-2">Source</th>
                <th className="px-2 py-2">Fees</th>
                <th className="px-2 py-2">Narration</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-4 font-medium">{event.eventType}</td>
                  <td className="px-2 py-2 tabular-nums text-muted-foreground">{event.effectiveDate ?? event.postingDate ?? "—"}</td>
                  <td className="px-2 py-2 font-medium">{event.ticker ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(event.quantity, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(event.grossValue)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMoney(event.netCashEffect)}</td>
                  <td className="px-2 py-2 text-muted-foreground">{event.sourceType}</td>
                  <td className="px-2 py-2">{event.feesKnown ? "Known" : "Unavailable"}</td>
                  <td className="px-2 py-2">
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">Show</summary>
                      <p className="mt-1 max-w-[26.25rem] leading-snug text-muted-foreground">{event.originalNarration}</p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
