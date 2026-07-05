import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { cn, formatNumber, formatSignedPct } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney } from "@/components/animated-money";
import { ActionButton } from "@/components/action-button";
import { AddTransactionDialog } from "@/components/add-transaction-dialog";
import { ImportantPsxEvents, type PsxEventRow } from "@/components/important-psx-events";
import { getClustersForTickers } from "@/lib/news/global-store";
import { getPrefs, type UserPrefs } from "@/lib/prefs";
import { AsOf } from "@/components/as-of";
import { MarkSeen } from "@/components/mark-seen";
import { DismissCheckButton } from "@/components/dashboard-checks";
import type { SupabaseClient } from "@supabase/supabase-js";
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

/** Dismissed check ids whose dismissal has not aged out (14 days). */
function dismissedCheckIds(map: Record<string, string> | undefined): Set<string> {
  const out = new Set<string>();
  if (!map) return out;
  const cutoff = Date.now() - 14 * 86_400_000;
  for (const [id, at] of Object.entries(map)) {
    if (new Date(at).getTime() >= cutoff) out.add(id);
  }
  return out;
}

/** One quiet line summarising what changed since the previous dashboard visit. */
async function buildSinceLastVisit(
  supabase: SupabaseClient,
  userId: string,
  lastSeen: string | null,
  liveValue: number
): Promise<string | null> {
  if (!lastSeen) return null;
  const seenMs = new Date(lastSeen).getTime();
  if (Number.isNaN(seenMs) || Date.now() - seenMs < 20 * 3_600_000) return null; // less than ~a day: stay quiet

  const seenDate = new Date(lastSeen).toISOString().slice(0, 10);
  const [snapRes, divRes] = await Promise.all([
    supabase
      .from("portfolio_snapshots")
      .select("total_value, snapshot_date")
      .eq("user_id", userId)
      .lte("snapshot_date", seenDate)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("dividends")
      .select("net_amount, amount")
      .eq("user_id", userId)
      .eq("status", "received")
      .gte("payment_date", seenDate),
  ]);

  const parts: string[] = [];
  const priorValue = snapRes.data?.total_value ? Number(snapRes.data.total_value) : null;
  if (priorValue && priorValue > 0) {
    const delta = liveValue - priorValue;
    parts.push(`portfolio value ${delta >= 0 ? "up" : "down"} ${formatNumber(Math.abs(delta), 0)} PKR`);
  }
  const dividendsSince = (divRes.data ?? []).reduce((s, d) => s + Number(d.net_amount ?? d.amount ?? 0), 0);
  if (dividendsSince > 0) parts.push(`${formatNumber(dividendsSince, 0)} PKR in dividends received`);

  if (parts.length === 0) return null;
  return `Since your last visit: ${parts.join(", ")}.`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  // Critical path: only the data the hero, summary and allocations need to
  // paint. The charts and PSX events fetch their own slices and stream in
  // behind Suspense, so the page shell and headline numbers render immediately.
  const [summary, dailyPerformance, profileRes, prefs] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDailyHoldingPerformance(supabase, user.id),
    supabase.from("profiles").select("demo_mode, full_name").eq("id", user.id).maybeSingle(),
    getPrefs(supabase, user.id).catch(() => ({}) as UserPrefs),
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
  const firstName = (profileRes.data?.full_name ?? "").trim().split(/\s+/)[0] || null;
  const isDemo = Boolean(profileRes.data?.demo_mode);
  const dayPnl = dailyPerformance.totalDayPnl;
  const dayTone = dayPnl !== null && dayPnl > 0 ? "positive" : dayPnl !== null && dayPnl < 0 ? "negative" : "flat";
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
  // Each check carries a stable id keyed on the fact it reports, so a dismissal
  // sticks until the same fact reappears. Only checks not currently dismissed
  // surface, so a check the user has acknowledged stops nagging.
  const allChecks = [
    ...(summary.largestHolding && (summary.largestHolding.weight ?? 0) >= CHECK_THRESHOLDS.holdingWeight
      ? [{ id: `holding:${summary.largestHolding.ticker}`, title: "Large holding", detail: `${summary.largestHolding.ticker} represents ${summary.largestHolding.weight!.toFixed(1)}% of portfolio value.`, href: `/stocks/${summary.largestHolding.ticker}` }]
      : []),
    ...(summary.largestSector && summary.largestSector.weight >= CHECK_THRESHOLDS.sectorWeight
      ? [{ id: `sector:${summary.largestSector.sector}`, title: "Sector concentration", detail: `${summary.largestSector.sector} represents ${summary.largestSector.weight.toFixed(1)}% of portfolio value.`, href: "/holdings" }]
      : []),
    ...summary.holdings
      .filter((holding) => (holding.unrealized_pl_pct ?? 0) <= CHECK_THRESHOLDS.belowCost)
      .slice(0, 2)
      .map((holding) => ({ id: `belowcost:${holding.ticker}`, title: "Below cost", detail: `${holding.ticker} is ${formatSignedPct(holding.unrealized_pl_pct)} below its average cost.`, href: `/stocks/${holding.ticker}` })),
    ...dailyPerformance.rows
      .filter((row) => Math.abs(row.dayChangePct ?? 0) >= CHECK_THRESHOLDS.dailyMove)
      .slice(0, 2)
      .map((row) => ({ id: `move:${row.ticker}:${dailyPerformance.asOf ?? "today"}`, title: "Large daily move", detail: `${row.ticker} moved ${formatSignedPct(row.dayChangePct)} today.`, href: `/stocks/${row.ticker}` })),
  ];
  const dismissed = dismissedCheckIds(prefs.dismissed_checks);
  const checks = allChecks.filter((c) => !dismissed.has(c.id)).slice(0, 4);

  const latestMarketDate = dailyPerformance.asOf ?? null;

  // Nearest upcoming dividend for a held ticker (from the reconciled events).
  const { data: nextDivRow } = await supabase
    .from("dividend_events")
    .select("ticker, company_name, ex_date, payment_date, estimated_payment_start, net_expected")
    .eq("user_id", user.id)
    .in("status", ["announced", "expected"])
    .gte("ex_date", latestMarketDate ?? new Date().toISOString().slice(0, 10))
    .order("ex_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextDividend = nextDivRow
    ? `Next dividend: ${nextDivRow.ticker} ex-date ${nextDivRow.ex_date}${nextDivRow.net_expected ? `, about ${formatNumber(nextDivRow.net_expected, 0)} PKR net` : ""}`
    : null;

  // "Since your last visit": value change and dividends landed since the prior
  // dashboard visit. Only when the gap is more than a day, so a same-day revisit
  // stays quiet.
  const sinceLastVisit = await buildSinceLastVisit(supabase, user.id, prefs.dashboard_last_seen_at ?? null, summary.totalValue + summary.cashBalance);

  // Link a mover to a likely cause: a recent news cluster for a holding that
  // moved beyond the daily-move threshold.
  const moverTickers = dailyPerformance.rows
    .filter((row) => Math.abs(row.dayChangePct ?? 0) >= CHECK_THRESHOLDS.dailyMove)
    .map((row) => row.ticker);
  const moverClusters = moverTickers.length ? await getClustersForTickers(supabase, moverTickers, { limit: 12 }) : [];
  const causes: Record<string, { url: string; title: string }> = {};
  for (const cluster of moverClusters) {
    if (cluster.ticker && cluster.url && !causes[cluster.ticker]) {
      causes[cluster.ticker] = { url: cluster.url, title: cluster.title };
    }
  }

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
            <div className="mt-4"><AsOf date={latestMarketDate} time={dailyPerformance.snapshotTime} label="Last updated" /></div>
            {sinceLastVisit && <p className="mt-3 text-xs text-muted-foreground">{sinceLastVisit}</p>}
            {nextDividend && <p className="mt-1 text-xs text-muted-foreground">{nextDividend}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!isDemo && <ActionButton endpoint="/api/prices" body={{ refresh: true }} label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh prices</>} size="sm" />}
          </div>
        </div>
      </header>

      {isDemo && <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">Read-only demo: the portfolio data below is seeded for exploration.</p>}

      <Suspense fallback={<ChartsSkeleton />}>
        <DashboardCharts userId={user.id} liveValue={summary.totalValue + summary.cashBalance} />
      </Suspense>

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
        <PortfolioContribution rows={dailyPerformance.rows.map((row) => ({ ticker: row.ticker, companyName: row.companyName, contribution: row.dayPnl, priceMove: row.dayChangePct, weight: row.weight }))} gainers={dailyPerformance.gainers} losers={dailyPerformance.losers} causes={causes} />
        <DashboardAllocation sectors={sectorAllocations} holdings={holdingAllocations} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {checks.length > 0 && (
          <section className="border-t border-border pt-4">
            <div className="flex items-center gap-2"><CircleAlert className="h-4 w-4 text-muted-foreground" /><h2 className="text-base font-semibold">Portfolio checks</h2></div>
            <div className="mt-3 divide-y divide-border">
              {checks.map((check) => (
                <div key={check.id} className="flex items-start justify-between gap-2 py-3 first:pt-1 last:pb-0 hover:bg-muted/30">
                  <Link href={check.href} className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{check.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{check.detail}</p>
                  </Link>
                  {!isDemo && <DismissCheckButton checkId={check.id} />}
                </div>
              ))}
            </div>
          </section>
        )}
        <Suspense fallback={<EventsSkeleton />}>
          <DashboardEvents userId={user.id} tickers={tickers} />
        </Suspense>
      </div>
      <MarkSeen surface="dashboard" />
    </div>
  );
}

/**
 * Snapshot-history and benchmark charts. Fetched in its own boundary so the two
 * larger time-series queries never block the headline numbers from painting.
 */
async function DashboardCharts({ userId, liveValue }: { userId: string; liveValue: number }) {
  const supabase = await createClient();
  const [snapshotsRes, benchmarkRes, marketSnapRes] = await Promise.all([
    supabase
      .from("portfolio_snapshots")
      .select("snapshot_date, total_value, total_cost")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: true })
      .limit(365),
    supabase
      .from("benchmark_series")
      .select("point_date, contributed, portfolio, kse100, inflation, cpi")
      .eq("user_id", userId)
      .order("point_date", { ascending: true }),
    supabase
      .from("market_snapshots")
      .select("snapshot_date, index_value")
      .eq("market", "PSX")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const datedSnapshots = (snapshotsRes.data ?? []).map((snapshot) => ({
    date: snapshot.snapshot_date,
    value: Number(snapshot.total_value),
    cost: Number(snapshot.total_cost),
  }));
  let benchmarkSeries: BenchmarkPointRow[] = (benchmarkRes.data ?? []).map((point) => ({
    date: point.point_date,
    contributed: Number(point.contributed),
    portfolio: Number(point.portfolio),
    kse100: Number(point.kse100),
    inflation: Number(point.inflation),
    cpi: point.cpi !== null ? Number(point.cpi) : null,
  }));

  // Splice in a "today" point valued like the header (live holdings + cash) so
  // the growth chart never trails the headline between benchmark rebuilds. The
  // KSE-100 equivalent is scaled to the live index level when the market
  // snapshot is newer than the stored series; the other lines carry forward.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const anchor = benchmarkSeries.filter((p) => p.date <= today).at(-1);
  if (anchor && liveValue > 0) {
    let kse100 = anchor.kse100;
    const liveIndex = marketSnapRes.data?.index_value ? Number(marketSnapRes.data.index_value) : null;
    if (liveIndex && marketSnapRes.data!.snapshot_date > anchor.date) {
      const { data: kseRow } = await supabase
        .from("company_price_history")
        .select("close")
        .eq("ticker", "KSE100")
        .lte("price_date", anchor.date)
        .order("price_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const baseClose = Number(kseRow?.close ?? 0);
      if (baseClose > 0) kse100 = Math.round(anchor.kse100 * (liveIndex / baseClose) * 100) / 100;
    }
    benchmarkSeries = [
      ...benchmarkSeries.filter((p) => p.date < today),
      { date: today, contributed: anchor.contributed, portfolio: liveValue, kse100, inflation: anchor.inflation, cpi: anchor.cpi },
    ];
  }

  return (
    <>
      {benchmarkSeries.length >= 2 && <BenchmarkGrowthChart data={benchmarkSeries} />}
      <DashboardPerformance data={datedSnapshots} />
    </>
  );
}

/** Recent dividend / result / corporate-action news for held tickers. */
async function DashboardEvents({ userId, tickers }: { userId: string; tickers: string[] }) {
  const supabase = await createClient();
  const categories = ["dividend", "result", "corporate_announcement"];

  // Prefer the shared, de-duplicated cluster store; fall back to the legacy
  // per-user table until the cluster backfill has run.
  const clusters = await getClustersForTickers(supabase, tickers, { categories, limit: 5 });
  if (clusters.length > 0) {
    const events: PsxEventRow[] = clusters
      .filter((c) => c.url)
      .map((c) => ({
        id: c.id,
        ticker: c.ticker,
        title: c.title,
        url: c.url as string,
        category: c.category,
        published_at: c.last_published_at,
        articleCount: c.article_count,
      }));
    return <ImportantPsxEvents events={events} />;
  }

  const { data: eventsData } = await supabase
    .from("news_articles")
    .select("id, ticker, title, url, category, published_at")
    .eq("user_id", userId)
    .eq("ignored", false)
    .in("ticker", tickers)
    .in("category", categories)
    .order("published_at", { ascending: false })
    .limit(5);

  return <ImportantPsxEvents events={(eventsData ?? []) as PsxEventRow[]} />;
}

function ChartsSkeleton() {
  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4">
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="h-80 w-full rounded-md" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <Skeleton className="mb-4 h-4 w-36" />
        <Skeleton className="h-52 w-full rounded-md" />
      </div>
    </>
  );
}

function EventsSkeleton() {
  return (
    <section className="border-t border-border pt-4">
      <Skeleton className="h-4 w-44" />
      <div className="mt-3 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    </section>
  );
}

function MetricInline({ label, value, sub, tone }: { label: string; value: ReactNode; sub: string; tone: "positive" | "negative" | "flat" }) {
  return <div><span className="text-muted-foreground">{label} </span><span className={cn("font-semibold tabular-nums", tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "text-foreground")}>{value} ({sub})</span></div>;
}

function SummaryMetric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "positive" | "negative" | "flat" }) {
  return <div className="border-b border-border py-4 last:border-b-0 sm:border-b-0 sm:px-4 sm:first:pl-0 sm:border-r sm:last:border-r-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "text-foreground")}>{value}</p>{sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}</div>;
}
