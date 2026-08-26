import { Suspense } from "react";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { getCachedMarketGlobal } from "@/lib/market/read";
import { cn, formatNumber, formatSignedPct } from "@/lib/shared/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Band } from "@/components/ui/band";
import { PanelHeader } from "@/components/ui/panel-header";
import { AddTransactionDialog } from "@/components/features/holdings/add-transaction-dialog";
import { ImportantPsxEvents, type PsxEventRow } from "@/components/features/dashboard/important-psx-events";
import { GrowthChart, type GrowthPoint } from "@/components/features/dashboard/growth-chart";
import { ContributionLedger } from "@/components/features/dashboard/dashboard-bands";
import { AllocationPanel, type ActiveWeightRow } from "@/components/features/dashboard/dashboard-bands";
import { PositionsTable, type PositionRow } from "@/components/features/dashboard/positions-table";
import { getClustersForTickers } from "@/lib/news/global-store";
import { AsOf } from "@/components/shared/as-of";
import { MarkSeen } from "@/components/shared/mark-seen";
import { Sparkline } from "@/components/shared/sparkline";
import { shortSector } from "@/lib/shared/sector-colors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Briefcase } from "lucide-react";

export const dynamic = "force-dynamic";

const GUTTER = "px-3 sm:px-4 md:px-(--gutter-page)";

/** SVG area path for the hero's faint portfolio motif, viewBox 1000×220. */
function motifPath(values: number[]): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values) * 0.98;
  const max = Math.max(...values) * 1.01 || 1;
  const x = (i: number) => (i / (values.length - 1)) * 1000;
  const y = (v: number) => 210 - ((v - min) / (max - min || 1)) * 190;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return `${line} L 1000 220 L 0 220 Z`;
}

/** Benchmark growth series with the same live "today" splice the old chart used. */
async function getBenchmarkSeries(supabase: SupabaseClient, userId: string, liveValue: number) {
  const [benchmarkRes, marketSnapRes] = await Promise.all([
    supabase
      .from("benchmark_series")
      .select("point_date, contributed, portfolio, kse100")
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
  let series = (benchmarkRes.data ?? []).map((p) => ({
    date: p.point_date as string,
    contributed: Number(p.contributed),
    portfolio: Number(p.portfolio),
    kse100: Number(p.kse100),
  }));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const anchor = series.filter((p) => p.date <= today).at(-1);
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
    series = [
      ...series.filter((p) => p.date < today),
      { date: today, contributed: anchor.contributed, portfolio: liveValue, kse100 },
    ];
  }
  return series;
}

/** Last-two-weeks closes per held ticker for the 7d sparklines. */
async function getSparks(supabase: SupabaseClient, tickers: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (tickers.length === 0) return out;
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("company_price_history")
    .select("ticker, close, price_date")
    .in("ticker", tickers)
    .gte("price_date", since)
    .order("price_date", { ascending: true });
  for (const row of data ?? []) {
    const t = String(row.ticker);
    if (!out.has(t)) out.set(t, []);
    out.get(t)!.push(Number(row.close));
  }
  for (const [t, vals] of out) out.set(t, vals.slice(-7));
  return out;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dailyPerformance, profileRes, marketGlobal] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDailyHoldingPerformance(supabase, user.id),
    supabase.from("profiles").select("demo_mode, full_name").eq("id", user.id).maybeSingle(),
    getCachedMarketGlobal().catch(() => null),
  ]);

  if (summary.holdingsCount === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-12">
        <p className="eyebrow">Get started</p>
        <h1 className="mt-1.5 font-display text-3xl font-normal tracking-editorial text-text-strong">Portfolio dashboard</h1>
        <EmptyState
          icon={Briefcase}
          title="Your portfolio is empty"
          description="Add a manual buy transaction to start tracking holdings, dividends, portfolio value and allocations."
          action={<AddTransactionDialog label="Add transaction" variant="default" />}
        />
      </div>
    );
  }

  const isDemo = Boolean(profileRes.data?.demo_mode);
  const tickers = summary.holdings.map((h) => h.ticker);
  const liveValue = summary.totalValue + summary.cashBalance;

  const [series, sparks] = await Promise.all([
    getBenchmarkSeries(supabase, user.id, liveValue),
    getSparks(supabase, tickers),
  ]);

  const dayPnl = dailyPerformance.totalDayPnl;
  const latestMarketDate = dailyPerformance.asOf ?? null;
  const dailyByTicker = new Map(dailyPerformance.rows.map((r) => [r.ticker, r]));

  // ── Hero: benchmark comparison + motif + 12-month sparkline ─────────────
  const lastB = series.at(-1);
  const bench = lastB && lastB.contributed > 0
    ? {
        portfolioPct: (lastB.portfolio / lastB.contributed - 1) * 100,
        ksePct: (lastB.kse100 / lastB.contributed - 1) * 100,
        gain: lastB.portfolio - lastB.contributed,
      }
    : null;
  const benchDelta = bench ? bench.portfolioPct - bench.ksePct : null;
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const heroSpark = series.filter((p) => p.date >= yearAgo).map((p) => p.portfolio);
  const motif = motifPath(series.map((p) => p.portfolio));

  // ── Positions, contribution, allocation ─────────────────────────────────
  const positionRows: PositionRow[] = [...summary.holdings]
    .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
    .map((h) => ({
      ticker: h.ticker,
      name: h.company_name ?? null,
      sector: h.sector ?? null,
      qty: h.quantity ?? 0,
      avg: h.avg_cost ?? null,
      price: h.latest_price,
      dayPct: dailyByTicker.get(h.ticker)?.dayChangePct ?? null,
      value: h.market_value,
      weight: h.weight,
      spark: sparks.get(h.ticker) ?? null,
    }));

  const sectorByTicker = new Map(summary.holdings.map((h) => [h.ticker, h.sector ?? null]));
  const contributionRows = dailyPerformance.rows
    .filter((r) => r.dayPnl !== null)
    .map((r) => ({
      ticker: r.ticker,
      sector: sectorByTicker.get(r.ticker) ?? null,
      contrib: r.dayPnl as number,
      pricePct: r.dayChangePct,
      weight: r.weight,
    }));

  const holdingCounts = new Map<string, number>();
  for (const h of summary.holdings) {
    const s = h.sector || "Unclassified";
    holdingCounts.set(s, (holdingCounts.get(s) ?? 0) + 1);
  }
  const sectorSlices = [...summary.sectorWeights]
    .sort((a, b) => b.value - a.value)
    .map((s) => ({
      label: shortSector(s.sector),
      fullLabel: s.sector,
      sector: s.sector,
      value: s.value,
      weight: s.weight,
      meta: `${holdingCounts.get(s.sector) ?? 0} holding${(holdingCounts.get(s.sector) ?? 0) === 1 ? "" : "s"}`,
    }));
  const holdingSlices = [...summary.holdings]
    .sort((a, b) => (b.market_value ?? 0) - (a.market_value ?? 0))
    .map((h) => ({
      label: h.ticker,
      fullLabel: `${h.company_name ?? h.ticker} · ${h.sector ?? "Unclassified"}`,
      sector: h.sector ?? null,
      value: h.market_value ?? h.total_cost ?? 0,
      weight: h.weight ?? 0,
      meta: shortSector(h.sector),
    }));

  // Index sector weights, proxied from the snapshot's market-cap coverage.
  const activeWeights: ActiveWeightRow[] = (() => {
    const heatmap = marketGlobal?.heatmap ?? [];
    const capBySector = new Map<string, number>();
    let capTotal = 0;
    for (const item of heatmap) {
      const cap = Number(item.market_cap ?? 0);
      if (!item.sector || cap <= 0) continue;
      capBySector.set(item.sector, (capBySector.get(item.sector) ?? 0) + cap);
      capTotal += cap;
    }
    if (capTotal <= 0) return [];
    return summary.sectorWeights.map((s) => ({
      sector: s.sector,
      mineW: s.weight,
      idxW: ((capBySector.get(s.sector) ?? 0) / capTotal) * 100,
    }));
  })();


  const dayTone = dayPnl !== null && dayPnl > 0 ? "text-up" : dayPnl !== null && dayPnl < 0 ? "text-down" : "text-text-strong";

  return (
    <div className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
      {/* ── Hero: tinted band, motif, sparkline, KSE rail, metric strip ── */}
      <Band
        tone="paper"
        className={cn("relative overflow-hidden pb-0", GUTTER)}
      >
        <div className="absolute inset-0" style={{ background: "color-mix(in oklab, var(--indigo-4) 45%, var(--surface-page))" }} />
        {motif && (
          <svg viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-50 w-full opacity-[0.07]">
            <path d={motif} fill="var(--indigo-2)" />
          </svg>
        )}

        <div className="relative z-2 flex flex-wrap items-start justify-between gap-6">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-indigo" />
            <div className="flex flex-wrap items-end gap-5">
              <h1 className="text-[2.25rem] font-semibold leading-none tracking-editorial text-text-strong sm:text-(length:--text-display)">
                <span className="mr-3 align-[0.48em] text-[0.36em] font-semibold tracking-(--tracking-caps) text-text-faint">PKR</span>
                <span className="figure font-semibold"><AnimatedMoney value={summary.totalValue} duration={1300} currency={false} decimals={0} /></span>
              </h1>
              {heroSpark.length >= 2 && (
                <span className="inline-flex items-center gap-2.5 pb-2">
                  <Sparkline data={heroSpark} width={96} height={30} />
                  <span className="flex flex-col gap-px text-(length:--text-3xs) leading-snug text-text-faint">
                    <span className="uppercase tracking-(--tracking-caps)">Portfolio value</span>
                    <span>Last 12 months</span>
                  </span>
                </span>
              )}
            </div>
            <div className="mt-3.5 flex flex-wrap gap-x-7 gap-y-2 text-sm text-text-muted">
              <span>
                Today{" "}
                <strong className={cn("figure font-semibold", dayTone)}>
                  <AnimatedMoney value={dayPnl} signed delay={100} duration={900} currency={false} decimals={0} /> ({formatSignedPct(dailyPerformance.weightedDayChangePct)})
                </strong>
              </span>
              {bench && (
                <span>
                  Total return{" "}
                  <strong className={cn("figure font-semibold", bench.gain >= 0 ? "text-up" : "text-down")}>
                    {bench.gain < 0 ? "−" : "+"}{formatNumber(Math.abs(bench.gain), 0)} ({formatSignedPct(bench.portfolioPct)})
                  </strong>
                </span>
              )}
            </div>
          </div>

          {bench && benchDelta !== null && (
            <div className="flex flex-col items-end gap-3 pt-1 text-right">
              <p className="eyebrow">Against the KSE-100</p>
              <span className="flex items-baseline gap-2.5">
                <span className={cn("figure text-(length:--text-h1) font-semibold tracking-editorial", benchDelta >= 0 ? "text-up" : "text-down")}>
                  {formatSignedPct(benchDelta)}
                </span>
                <span className="text-xs text-text-faint">{benchDelta >= 0 ? "ahead" : "behind"}</span>
              </span>
              <span className="flex flex-col gap-1 text-xs text-text-muted">
                <span>Portfolio <strong className="figure font-semibold text-text-strong">{formatSignedPct(bench.portfolioPct)}</strong></span>
                <span>KSE-100 <strong className="figure font-semibold text-text-strong">{formatSignedPct(bench.ksePct)}</strong></span>
              </span>
              <AsOf date={latestMarketDate} time={dailyPerformance.snapshotTime} label="Last updated" live />
            </div>
          )}
        </div>

        {isDemo && <p className="relative z-2 mt-5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">Read-only demo: the portfolio data below is seeded for exploration.</p>}

        <div className="relative z-2 -mx-3 mt-7 sm:-mx-4 md:-mx-(--gutter-page)">
          <div className="grid border-y border-rule sm:grid-cols-2 lg:grid-cols-4">
            <HeroMetric label="Total cost" value={<AnimatedMoney value={summary.totalCost} delay={120} currency={false} decimals={0} />} sub="PKR" first />
            <HeroMetric label="Unrealised P/L" value={<AnimatedMoney value={summary.unrealizedPl} signed delay={180} currency={false} decimals={0} />} sub={formatSignedPct(summary.unrealizedPlPct)} tone={summary.unrealizedPl > 0 ? "up" : summary.unrealizedPl < 0 ? "down" : undefined} />
            <HeroMetric label="Dividends received" value={<AnimatedMoney value={summary.dividendIncome} delay={240} currency={false} decimals={0} />} sub="Since first transaction" />
            <HeroMetric label="Broker cash" value={<AnimatedMoney value={summary.cashBalance} delay={300} currency={false} decimals={0} />} sub="Uninvested" last />
          </div>
        </div>
        <p className="relative z-2 py-3 pb-5 text-xs text-text-muted">
          {formatNumber(summary.holdingsCount, 0)} holdings · Largest holding: {summary.largestHolding ? `${summary.largestHolding.ticker}, ${summary.largestHolding.weight?.toFixed(1)}%` : "—"} · Largest sector: {summary.largestSector ? `${shortSector(summary.largestSector.sector)}, ${summary.largestSector.weight.toFixed(1)}%` : "—"}
        </p>
      </Band>

      {/* ── Growth of capital ── */}
      <Band tone="paper" className={cn("dot-grid", GUTTER)}>
        <GrowthChart
          data={series.map((p): GrowthPoint => ({ date: p.date, portfolio: p.portfolio, contributed: p.contributed }))}
          asOf={latestMarketDate}
          canRefresh={!isDemo}
        />
      </Band>

      {/* ── Positions at close ── */}
      <Band tone="paper" className={GUTTER}>
        <div className="mb-4">
          <span className="mb-3.5 block h-0.75 w-11 bg-clay" />
          <h2 className="font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Positions at close</h2>
        </div>
        <PositionsTable rows={positionRows} />
      </Band>

      {/* ── Contribution · allocation · events ── */}
      <Band tone="paper" rule="none" className={GUTTER}>
        <div className="grid items-start gap-12 xl:grid-cols-2">
          <div>
            <PanelHeader title="Daily contribution" />
            <ContributionLedger rows={contributionRows} />
          </div>
          <AllocationPanel sectors={sectorSlices} holdings={holdingSlices} activeWeights={activeWeights} totalValue={summary.totalValue} />
        </div>

        <div className="mt-9 border-t border-rule pt-7">
          <Suspense fallback={<EventsSkeleton />}>
            <DashboardEvents tickers={tickers} userId={user.id} />
          </Suspense>
        </div>
      </Band>
      <MarkSeen surface="dashboard" />
    </div>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  tone,
  first,
  last,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "up" | "down";
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-t border-rule px-3 py-4 first:border-t-0 sm:border-t-0 sm:border-l sm:px-6 sm:first:border-l-0",
        first && "md:pl-(--gutter-page)",
        last && "md:pr-(--gutter-page)"
      )}
    >
      <p className="text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</p>
      <p className={cn("figure mt-1.5 text-(length:--text-h1) font-semibold", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text-strong")}>{value}</p>
      {sub && <p className="figure mt-0.5 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

/** PSX filings for held tickers; streamed behind Suspense. */
async function DashboardEvents({ tickers, userId }: { tickers: string[]; userId: string }) {
  const supabase = await createClient();
  const categories = ["dividend", "result", "corporate_announcement"];
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

function EventsSkeleton() {
  return (
    <section>
      <Skeleton className="h-5 w-52" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>
    </section>
  );
}
