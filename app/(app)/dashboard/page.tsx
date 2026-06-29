import Link from "next/link";
import type { ReactNode } from "react";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { cn, formatNumber, formatSignedPct } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { AnimatedMoney } from "@/components/animated-money";
import { ActionButton } from "@/components/action-button";
import { AddTransactionDialog } from "@/components/add-transaction-dialog";
import { ImportantPsxEvents, type PsxEventRow } from "@/components/important-psx-events";
import { DashboardAllocation, DashboardPerformance, PortfolioContribution } from "@/components/dashboard-visuals";
import { BenchmarkGrowthChart, type BenchmarkPointRow } from "@/components/benchmark-growth-chart";
import { Briefcase, CircleAlert, RefreshCw } from "lucide-react";

export const dynamic = "force-dynamic";

const CHECK_THRESHOLDS = {
  holdingWeight: 20,
  sectorWeight: 40,
  belowCost: -10,
  dailyMove: 5,
} as const;

function formatUpdated(date: string | null, time: string | null) {
  if (!date) return "No market update available";
  const displayDate = new Intl.DateTimeFormat("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
  return `${displayDate}${time ? `, ${time.slice(0, 5)}` : ""}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dailyPerformance, snapshotsRes, benchmarkRes, profileRes] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDailyHoldingPerformance(supabase, user.id),
    supabase
      .from("portfolio_snapshots")
      .select("snapshot_date, total_value, total_cost")
      .eq("user_id", user.id)
      .order("snapshot_date", { ascending: true })
      .limit(365),
    supabase
      .from("benchmark_series")
      .select("point_date, contributed, portfolio, kse100, inflation, cpi")
      .eq("user_id", user.id)
      .order("point_date", { ascending: true }),
    supabase.from("profiles").select("demo_mode, full_name").eq("id", user.id).maybeSingle(),
  ]);

  if (summary.holdingsCount === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-12">
        <p className="eyebrow">Get started</p>
        <h1 className="mt-1 text-3xl font-semibold">Portfolio dashboard</h1>
        <EmptyState
          icon={Briefcase}
          title="Your portfolio is empty"
          description="Add a manual buy transaction to start tracking holdings, dividends, portfolio value and allocations."
          action={<AddTransactionDialog label="Add transaction" variant="default" />}
        />
      </div>
    );
  }

  const tickers = summary.holdings.map((holding) => holding.ticker);
  const { data: eventsData } = await supabase
    .from("news_articles")
    .select("id, ticker, title, url, category, published_at")
    .eq("user_id", user.id)
    .eq("ignored", false)
    .in("ticker", tickers)
    .in("category", ["dividend", "result", "corporate_announcement"])
    .order("published_at", { ascending: false })
    .limit(5);

  const firstName = (profileRes.data?.full_name ?? "").trim().split(/\s+/)[0] || null;
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const dayPnl = dailyPerformance.totalDayPnl;
  const dayTone = dayPnl !== null && dayPnl > 0 ? "positive" : dayPnl !== null && dayPnl < 0 ? "negative" : "flat";
  const datedSnapshots = (snapshotsRes.data ?? []).map((snapshot) => ({
    date: snapshot.snapshot_date,
    value: Number(snapshot.total_value),
    cost: Number(snapshot.total_cost),
  }));
  const benchmarkSeries: BenchmarkPointRow[] = (benchmarkRes.data ?? []).map((point) => ({
    date: point.point_date,
    contributed: Number(point.contributed),
    portfolio: Number(point.portfolio),
    kse100: Number(point.kse100),
    inflation: Number(point.inflation),
    cpi: point.cpi !== null ? Number(point.cpi) : null,
  }));
  const sectorAllocations = summary.sectorWeights.map((sector) => ({
    label: sector.sector,
    value: sector.value,
    weight: sector.weight,
    holdings: summary.holdings.filter((holding) => (holding.sector || "Uncategorized") === sector.sector).length,
  }));
  const holdingAllocations = summary.holdings
    .map((holding) => ({
      label: holding.ticker,
      value: holding.market_value ?? holding.total_cost,
      weight: holding.weight ?? 0,
      holdings: 1,
    }))
    .sort((a, b) => b.value - a.value);
  const checks = [
    ...(summary.largestHolding && (summary.largestHolding.weight ?? 0) >= CHECK_THRESHOLDS.holdingWeight
      ? [{ title: "Large holding", detail: `${summary.largestHolding.ticker} represents ${summary.largestHolding.weight!.toFixed(1)}% of portfolio value.`, href: `/stocks/${summary.largestHolding.ticker}` }]
      : []),
    ...(summary.largestSector && summary.largestSector.weight >= CHECK_THRESHOLDS.sectorWeight
      ? [{ title: "Sector concentration", detail: `${summary.largestSector.sector} represents ${summary.largestSector.weight.toFixed(1)}% of portfolio value.`, href: "/holdings" }]
      : []),
    ...summary.holdings
      .filter((holding) => (holding.unrealized_pl_pct ?? 0) <= CHECK_THRESHOLDS.belowCost)
      .slice(0, 2)
      .map((holding) => ({ title: "Below cost", detail: `${holding.ticker} is ${formatSignedPct(holding.unrealized_pl_pct)} below its average cost.`, href: `/stocks/${holding.ticker}` })),
    ...dailyPerformance.rows
      .filter((row) => Math.abs(row.dayChangePct ?? 0) >= CHECK_THRESHOLDS.dailyMove)
      .slice(0, 2)
      .map((row) => ({ title: "Large daily move", detail: `${row.ticker} moved ${formatSignedPct(row.dayChangePct)} today.`, href: `/stocks/${row.ticker}` })),
  ].slice(0, 4);

  const latestMarketDate = dailyPerformance.asOf ?? datedSnapshots.at(-1)?.date ?? null;
  return (
    <div className="space-y-6 pb-4">
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{firstName ? `${firstName}'s portfolio` : "Portfolio overview"}{profileRes.data?.demo_mode ? " · demo mode" : ""}</p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Portfolio value</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl"><AnimatedMoney value={summary.totalValue} duration={1300} /></h1>
            <div className="mt-4 flex flex-wrap gap-x-7 gap-y-2 text-sm">
              <MetricInline label="Today" value={<AnimatedMoney value={dayPnl} signed delay={100} duration={900} />} sub={formatSignedPct(dailyPerformance.weightedDayChangePct)} tone={dayTone} />
              <MetricInline label="Overall return" value={<AnimatedMoney value={summary.unrealizedPl} signed delay={180} duration={1050} />} sub={formatSignedPct(summary.unrealizedPlPct)} tone={summary.unrealizedPl > 0 ? "positive" : summary.unrealizedPl < 0 ? "negative" : "flat"} />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">Last updated: {formatUpdated(latestMarketDate, dailyPerformance.snapshotTime)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isDemo && <ActionButton endpoint="/api/prices" body={{ refresh: true }} label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh prices</>} size="sm" />}
          </div>
        </div>
      </header>

      {isDemo && <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">Read-only demo: the portfolio data below is seeded for exploration.</p>}

      {benchmarkSeries.length >= 2 && <BenchmarkGrowthChart data={benchmarkSeries} />}

      <DashboardPerformance data={datedSnapshots} />

      <section>
        <div className="grid border-y border-border sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric label="Total cost" value={<AnimatedMoney value={summary.totalCost} delay={120} />} />
          <SummaryMetric label="Unrealised P/L" value={<AnimatedMoney value={summary.unrealizedPl} signed delay={180} />} sub={formatSignedPct(summary.unrealizedPlPct)} tone={summary.unrealizedPl > 0 ? "positive" : summary.unrealizedPl < 0 ? "negative" : "flat"} />
          <SummaryMetric label="Dividend income" value={<AnimatedMoney value={summary.dividendIncome} delay={240} />} />
          <SummaryMetric label="Cash" value={<AnimatedMoney value={summary.cashBalance} delay={300} />} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{formatNumber(summary.holdingsCount, 0)} holdings · Largest holding: {summary.largestHolding ? `${summary.largestHolding.ticker}, ${summary.largestHolding.weight?.toFixed(1)}%` : "—"} · Largest sector: {summary.largestSector ? `${summary.largestSector.sector}, ${summary.largestSector.weight.toFixed(1)}%` : "—"}</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <PortfolioContribution rows={dailyPerformance.rows.map((row) => ({ ticker: row.ticker, companyName: row.companyName, contribution: row.dayPnl, priceMove: row.dayChangePct, weight: row.weight }))} gainers={dailyPerformance.gainers} losers={dailyPerformance.losers} />
        <DashboardAllocation sectors={sectorAllocations} holdings={holdingAllocations} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {checks.length > 0 && (
          <section className="border-t border-border pt-4">
            <div className="flex items-center gap-2"><CircleAlert className="h-4 w-4 text-muted-foreground" /><h2 className="text-base font-semibold">Portfolio checks</h2></div>
            <div className="mt-3 divide-y divide-border">
              {checks.map((check) => <Link key={`${check.title}-${check.detail}`} href={check.href} className="block py-3 first:pt-1 last:pb-0 hover:bg-muted/30"><p className="text-sm font-medium">{check.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{check.detail}</p></Link>)}
            </div>
          </section>
        )}
        <ImportantPsxEvents events={(eventsData ?? []) as PsxEventRow[]} />
      </div>
    </div>
  );
}

function MetricInline({ label, value, sub, tone }: { label: string; value: ReactNode; sub: string; tone: "positive" | "negative" | "flat" }) {
  return <div><span className="text-muted-foreground">{label} </span><span className={cn("font-semibold tabular-nums", tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "text-foreground")}>{value} ({sub})</span></div>;
}

function SummaryMetric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "positive" | "negative" | "flat" }) {
  return <div className="border-b border-border py-4 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:pl-0 sm:border-r sm:last:border-r-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "text-foreground")}>{value}</p>{sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}</div>;
}
