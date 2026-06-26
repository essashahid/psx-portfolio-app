/* eslint-disable @next/next/no-html-link-for-pages -- export endpoint returns a file, not a page */
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPerformanceAnalytics } from "@/lib/engine/performance";
import { buildLedgerRows, type LedgerCashInput, type LedgerTxnInput } from "@/lib/engine/ledger-view";
import { getPortfolio } from "@/lib/portfolio";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { LedgerTable } from "@/components/ledger-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { CostFrictionBars, PerformanceTimeline, PerformanceWaterfall } from "@/components/charts-lazy";
import { BenchmarkGrowthChart } from "@/components/benchmark-growth-chart";
import { cn, formatMoney, formatNumber, formatSignedPct } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
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
          <p className="eyebrow">Portfolio</p>
          <h1 className="mt-1 text-2xl font-semibold">Performance</h1>
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
  const platformReconciled = quantityRows.filter((row) => row.status === "Reconciled").length;
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
  const currentUnrealized = usePlatformCurrent ? portfolio.unrealizedPl : returns.unrealizedPl;
  const currentWorthSource = usePlatformCurrent
    ? "Platform current holdings and latest prices"
    : "Adjusted AKD ledger endpoint";
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
  const sourceReconciled = analytics.source.status === "reconciled";

  return (
    <div className="space-y-8 pb-6">
      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Portfolio</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Performance</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Ledger-backed capital, realised return, unrealised return, costs and reconciliation.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={sourceReconciled ? "green" : sourceComplete ? "blue" : "amber"}>{analytics.source.label}</Badge>
              <span>{analytics.source.detail}</span>
            </div>
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
            <a href="#reconciliation">
              <Button variant="outline" size="sm">Reconcile</Button>
            </a>
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
        {sourceReconciled && (
          <div className="mt-4 flex gap-2 border-l-2 border-emerald-600 pl-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{analytics.source.detail}</p>
          </div>
        )}
      </header>

      <section className="border-y border-border py-4">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Current net worth" value={formatMoney(currentWorth)} sub={currentWorthSource} />
          <Metric
            label="Net investment gain"
            value={formatMoney(netGain)}
            sub={formatSignedPct(returns.totalDeposited ? (netGain / returns.totalDeposited) * 100 : null)}
            tone={netGain >= 0 ? "positive" : "negative"}
          />
          <Metric
            label="XIRR"
            value={returns.xirrPct !== null ? `${returns.xirrPct}%` : "Unavailable"}
            sub={`${returns.externalCashFlowEvents} external flows · ${returns.startDate ?? "—"} to ${returns.endDate ?? "—"}`}
            tone={returns.xirrPct !== null && returns.xirrPct > 0 ? "positive" : undefined}
          />
          <Metric label="External capital" value={formatMoney(returns.totalDeposited)} sub="Deposits plus external acquisitions" />
          <Metric
            label="Realised P/L"
            value={formatMoney(returns.realizedPl)}
            sub={`${checkpoints.brokerSellLinesImported} sell lines · ${checkpoints.brokerSellOrdersImported} sell orders`}
            tone={returns.realizedPl >= 0 ? "positive" : "negative"}
          />
          <Metric
            label="Unrealised P/L"
            value={formatMoney(currentUnrealized)}
            sub="Weighted-average adjusted cost basis"
            tone={currentUnrealized >= 0 ? "positive" : "negative"}
          />
          <Metric label="Net dividends" value={formatMoney(portfolio.dividendIncome)} sub="Dividend Income module; not double-counted in bridge" />
          <Metric label="Recorded deductions" value={formatMoney(friction.total)} sub={`${friction.pctOfDeposits}% of external capital`} tone="negative" />
        </div>
      </section>

      <LedgerTable rows={ledger.rows} transactions={transactions} cashMovements={cashMovements} />

      <section className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Wealth creation bridge</h2>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Trade commission, SST and CDC are already embedded in realised/unrealised P/L. Account charges and CGT are deducted separately.
            </p>
          </div>
          <div className={cn("text-xs", Math.abs(bridgeDifference) < 0.01 ? "text-emerald-700" : "text-red-700")}>
            {Math.abs(bridgeDifference) < 0.01
              ? "Bridge reconciles"
              : `Unreconciled difference: ${formatMoney(bridgeDifference)}`}
          </div>
        </div>
        <div className="mt-4">
          <PerformanceWaterfall data={bridge} />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Component</th>
                <th className="px-2 py-2 text-right">Value</th>
                <th className="px-2 py-2">Treatment</th>
                <th className="px-2 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {bridge.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-medium">{row.label}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", row.value < 0 ? "text-red-700" : row.value > 0 ? "text-emerald-700" : "")}>
                    {formatMoney(row.value)}
                  </td>
                  <td className="px-2 py-2">{row.includedInReconciliation ? "Included" : "Audit only"}</td>
                  <td className="px-2 py-2 text-muted-foreground">{row.note}</td>
                </tr>
              ))}
              <tr className="border-b border-border last:border-0">
                <td className="py-2 pr-4 font-medium">Net dividend income</td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{formatMoney(portfolio.dividendIncome)}</td>
                <td className="px-2 py-2">Displayed separately</td>
                <td className="px-2 py-2 text-muted-foreground">Included in total-return review without adding it twice to current cash or net worth.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Capital and net-worth timeline</h2>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Dated ledger cash flows, purchases, sales and charges. Portfolio market-value history is shown only at the supported endpoint.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-right text-xs">
            <Mini label="Avg deposit-to-buy" value={analytics.deployment.avgDaysDepositToBuy !== null ? `${analytics.deployment.avgDaysDepositToBuy} days` : "—"} />
            <Mini label="Within 24h" value={analytics.deployment.pctDeployedWithin24h !== null ? `${analytics.deployment.pctDeployedWithin24h}%` : "—"} />
            <Mini label="Cash share" value={analytics.deployment.pctCapitalCurrentlyCash !== null ? `${analytics.deployment.pctCapitalCurrentlyCash}%` : "—"} />
          </div>
        </div>
        <div className="mt-4">
          <PerformanceTimeline data={analytics.timeline} />
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <h2 className="text-lg font-semibold">Performance versus benchmarks</h2>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
          {analytics.benchmark
            ? `Your contribution schedule valued against the KSE-100 (total return) and PBS inflation through ${analytics.benchmark.asOf}.`
            : "Benchmark and inflation comparisons populate once the portfolio series has been built. Use Rebuild to fetch KSE-100 and PSX price history."}
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <StatusBlock
            title="Portfolio vs KSE-100"
            available={analytics.benchmarkStatus.kse100.available}
            reason={analytics.benchmarkStatus.kse100.reason}
            methodology={analytics.benchmarkStatus.kse100.methodology}
          />
          <StatusBlock
            title="Purchasing-power performance"
            available={analytics.benchmarkStatus.inflation.available}
            reason={analytics.benchmarkStatus.inflation.reason}
            methodology={analytics.benchmarkStatus.inflation.methodology}
          />
          <StatusBlock
            title="Portfolio drawdown"
            available={analytics.benchmarkStatus.drawdown.available}
            reason={analytics.benchmarkStatus.drawdown.reason}
            methodology="Drawdown will use a complete daily or monthly portfolio-value series when available."
          />
        </div>
        <div className="mt-4 grid gap-4 border-y border-border py-4 sm:grid-cols-3">
          <Metric label="Nominal gain" value={formatMoney(netGain)} sub="Current net worth less external capital" tone={netGain >= 0 ? "positive" : "negative"} />
          <Metric
            label="Inflation-adjusted capital"
            value={analytics.benchmark ? formatMoney(analytics.benchmark.inflationEquivalent) : "Unavailable"}
            sub={
              analytics.benchmark
                ? `Real value of contributions kept at PBS CPI · ${formatSignedPct(analytics.benchmark.inflationEquivalent ? (analytics.benchmark.excessVsInflation / analytics.benchmark.inflationEquivalent) * 100 : null)} purchasing power`
                : "Requires Pakistan CPI history"
            }
            tone={analytics.benchmark ? (analytics.benchmark.excessVsInflation >= 0 ? "positive" : "negative") : undefined}
          />
          <Metric
            label="Excess return vs KSE-100"
            value={analytics.benchmark ? formatMoney(analytics.benchmark.excessVsKse100) : "Unavailable"}
            sub={
              analytics.benchmark
                ? `Portfolio less KSE-100 total-return equivalent (${formatMoney(analytics.benchmark.kse100Equivalent)})`
                : "Requires cash-flow-matched total-return index"
            }
            tone={analytics.benchmark ? (analytics.benchmark.excessVsKse100 >= 0 ? "positive" : "negative") : undefined}
          />
        </div>
        {analytics.benchmark && analytics.benchmark.maxDrawdownPct !== null && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Metric
              label="Max drawdown"
              value={`${analytics.benchmark.maxDrawdownPct}%`}
              sub={`${formatMoney(analytics.benchmark.maxDrawdownValue ?? 0)} peak-to-trough`}
              tone="negative"
            />
            <Metric
              label="Drawdown peak"
              value={analytics.benchmark.drawdownPeakDate ?? "—"}
              sub="Highest portfolio NAV before the decline"
            />
            <Metric
              label="Drawdown trough"
              value={analytics.benchmark.drawdownTroughDate ?? "—"}
              sub="Lowest point reached after the peak"
            />
          </div>
        )}
        {analytics.benchmark && analytics.benchmark.series.length >= 2 && (
          <div className="mt-4">
            <BenchmarkGrowthChart data={analytics.benchmark.series} />
          </div>
        )}
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

      <section id="reconciliation" className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Reconciliation workspace</h2>
            <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
              Exact source counts, confirmed adjustments and ticker-level quantity checks. Differences are shown, not forced.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Expected total quantity {formatNumber(expectedTotalQuantity, 0)}
            {platformTotalQuantity !== null ? ` · platform ${formatNumber(platformTotalQuantity, 0)}` : ""}
          </div>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-2 text-sm md:grid-cols-2 xl:grid-cols-3">
          <Count label="External broker deposits imported" value={checkpoints.externalBrokerDepositsImported} expected={62} />
          <Count label="Broker buy lines imported" value={checkpoints.brokerBuyLinesImported} expected={110} />
          <Count label="Broker buy orders imported" value={checkpoints.brokerBuyOrdersImported} expected={73} />
          <Count label="Broker sell lines imported" value={checkpoints.brokerSellLinesImported} expected={8} />
          <Count label="Broker sell orders imported" value={checkpoints.brokerSellOrdersImported} expected={5} />
          <Count label="Manual purchases applied" value={checkpoints.manualPurchasesApplied} expected={2} />
          <Count label="IPO acquisitions applied" value={checkpoints.ipoAcquisitionsApplied} expected={2} />
          <Count label="Stock splits applied" value={checkpoints.stockSplitsApplied} expected={1} />
          <Count label="Merger conversions applied" value={checkpoints.mergerConversionsApplied} expected={1} />
          <Count label="Current holdings reconciled" value={platformHasHoldings ? platformReconciled : checkpoints.currentHoldingsReconciled} expected={16} />
          <Count label="Unexplained quantity differences" value={platformHasHoldings ? platformDifferences.length : checkpoints.unexplainedQuantityDifferences} expected={0} />
          <Count label="Unknown transaction-fee fields" value={checkpoints.unknownTransactionFeeFields} expected={6} neutral />
          <Count label="XIRR cash-flow count" value={checkpoints.xirrCashFlowCount} neutral />
          <Count label="Trading fees extracted" value={friction.tradeFeesTotal} money neutral />
          <Count label="Wealth-bridge difference" value={bridgeDifference} money expected={0} />
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Ticker</th>
                <th className="px-2 py-2 text-right">Broker net</th>
                <th className="px-2 py-2 text-right">Corporate action</th>
                <th className="px-2 py-2 text-right">External acquisition</th>
                <th className="px-2 py-2 text-right">Manual purchase</th>
                <th className="px-2 py-2 text-right">Expected</th>
                <th className="px-2 py-2 text-right">Platform</th>
                <th className="px-2 py-2 text-right">Difference</th>
                <th className="px-2 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {quantityRows.map((row) => (
                <tr key={row.ticker} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 font-semibold">{row.ticker}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.brokerNetQuantity, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.corporateActionAdjustment, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.externalAcquisitionQuantity, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.manualPurchaseQuantity, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium">{formatNumber(row.expectedQuantity, 0)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatNumber(row.currentPlatformQuantity, 0)}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", row.difference ? "text-red-700" : "text-muted-foreground")}>
                    {row.difference === null ? "—" : formatNumber(row.difference, 0)}
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant={row.status === "Reconciled" ? "green" : row.status === "Difference" ? "red" : "amber"}>
                      {row.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="min-w-0 border-l border-border pl-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "")}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
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

function StatusBlock({
  title,
  available,
  reason,
  methodology,
}: {
  title: string;
  available: boolean;
  reason: string;
  methodology: string;
}) {
  return (
    <div className="border-l border-border pl-3">
      <div className="flex items-center gap-2">
        {available ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{reason}</p>
      <p className="mt-2 text-xs text-muted-foreground">{methodology}</p>
    </div>
  );
}

function Count({
  label,
  value,
  expected,
  money = false,
  neutral = false,
}: {
  label: string;
  value: number;
  expected?: number;
  money?: boolean;
  neutral?: boolean;
}) {
  const ok = expected === undefined || Math.abs(value - expected) < 0.01;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums", !neutral && (ok ? "text-emerald-700" : "text-red-700"))}>
        {money ? formatMoney(value) : formatNumber(value, 2)}
      </span>
    </div>
  );
}

function RealisedTable({ sales }: { sales: NonNullable<Awaited<ReturnType<typeof getPerformanceAnalytics>>>["sales"] }) {
  return (
    <section className="border-t border-border pt-5">
      <h2 className="text-lg font-semibold">Realised performance</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Weighted-average cost allocated to each sale line. PPL remains partially realised because shares remain.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1040px] text-xs">
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
                    <p className="mt-2 max-w-[260px] text-[11px] leading-snug text-muted-foreground">
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
                <td className={cn("px-2 py-2 text-right font-medium tabular-nums", sale.realized >= 0 ? "text-emerald-700" : "text-red-700")}>{formatMoney(sale.realized)}</td>
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
      <h2 className="text-lg font-semibold">Performance by year</h2>
      <p className="mt-1 text-xs text-muted-foreground">Gross purchases are separate from external contributions. Benchmark and real-return columns stay unavailable until their series exist.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1260px] text-xs">
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
                <td className={cn("px-2 py-2 text-right tabular-nums", row.realizedPl >= 0 ? "text-emerald-700" : "text-red-700")}>{formatMoney(row.realizedPl)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.tradingCharges)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.accountCharges)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.cgtTariffs)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.buyLines}/{row.buyOrders}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.sellLines}/{row.sellOrders}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(row.endingNetWorth)}</td>
                <td className="px-2 py-2 text-right text-muted-foreground">Unavailable</td>
                <td className="px-2 py-2 text-right text-muted-foreground">Unavailable</td>
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
      <h2 className="text-lg font-semibold">Position build-up analysis</h2>
      <p className="mt-1 text-xs text-muted-foreground">Current holdings are aggregated under weighted-average accounting; purchase lots are not shown as separate holdings.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1180px] text-xs">
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
                <td className={cn("px-2 py-2 text-right tabular-nums", (row.unrealizedPl ?? 0) >= 0 ? "text-emerald-700" : "text-red-700")}>{formatMoney(row.unrealizedPl)}</td>
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
      <h2 className="text-lg font-semibold">Cost and friction analysis</h2>
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
            <table className="w-full min-w-[560px] text-xs">
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
      <h2 className="text-lg font-semibold">Audit and XIRR inputs</h2>
      <details className="mt-3 border-l border-border pl-3">
        <summary className="cursor-pointer text-sm font-medium">View XIRR cash flows</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
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
                  <td className={cn("px-2 py-2 text-right tabular-nums", row.amount < 0 ? "text-red-700" : "text-emerald-700")}>{formatMoney(row.amount)}</td>
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
        <div className="mt-3 max-h-[560px] overflow-auto">
          <table className="w-full min-w-[980px] text-xs">
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
                      <p className="mt-1 max-w-[420px] leading-snug text-muted-foreground">{event.originalNarration}</p>
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
