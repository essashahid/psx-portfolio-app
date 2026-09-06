import { Suspense } from "react";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { cn, formatNumber, formatSignedPct } from "@/lib/shared/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Cascade } from "@/components/shared/cascade";
import { Band } from "@/components/ui/band";
import { PanelHeader } from "@/components/ui/panel-header";
import { Metric } from "@/components/ui/metric";
import { AddTransactionDialog } from "@/components/features/holdings/add-transaction-dialog";
import { ImportantPsxEvents, type PsxEventRow } from "@/components/features/dashboard/important-psx-events";
import { GrowthChart, type GrowthPoint } from "@/components/features/dashboard/growth-chart";
import { ContributionLedger } from "@/components/features/dashboard/dashboard-bands";
import { AllocationPanel } from "@/components/features/dashboard/dashboard-bands";
import { PositionsTable, type PositionRow } from "@/components/features/dashboard/positions-table";
import { getClustersForTickers } from "@/lib/news/global-store";
import { AsOf } from "@/components/shared/as-of";
import { MarkSeen } from "@/components/shared/mark-seen";
import { Sparkline } from "@/components/shared/sparkline";
import { shortSector } from "@/lib/shared/sector-colors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Briefcase } from "lucide-react";
import Link from "next/link";
import { normalizeEnabledFeatures } from "@/lib/config/features";
import { taxYearOf } from "@psx/shared/dividends/tax-year";

export const dynamic = "force-dynamic";

const GUTTER = "px-3 sm:px-4 md:px-(--gutter-page)";

/**
 * A gain or a loss with its sign and a true minus, so the direction is legible
 * without reading the colour. U+2212 rather than a hyphen: a hyphen is narrower
 * than a digit and the column stops lining up.
 *
 * An unknown value prints a dash. The component this replaced coerced null to
 * zero and rendered "+0", which claims the book did not move when the truth is
 * that nothing here is priced.
 */
const fmtSigned = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "—"
    : `${v > 0 ? "+" : v < 0 ? "\u2212" : ""}${formatNumber(Math.abs(v), 0)}`;

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

/**
 * The compact dividends block under the hero: received this tax year, received
 * all time, and the next payout on the calendar. The next payout is labelled
 * by its status and is never presented as money in hand.
 */
async function getDividendSummary(supabase: SupabaseClient, userId: string, hiddenTickers: Set<string>) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const thisTaxYear = taxYearOf(today);
  const [receivedRes, nextRes] = await Promise.all([
    supabase.from("dividends").select("ticker, amount, net_amount, status, pay_date, payment_date").eq("user_id", userId),
    supabase
      .from("dividend_events")
      .select("ticker, status, payment_date, estimated_payment_start, net_expected, gross_expected")
      .eq("user_id", userId)
      .in("status", ["announced", "expected"])
      .or(`payment_date.gte.${today},estimated_payment_start.gte.${today}`)
      .order("payment_date", { ascending: true, nullsFirst: false })
      .limit(20),
  ]);
  let thisYear = 0;
  let allTime = 0;
  for (const d of receivedRes.data ?? []) {
    if ((d.status ?? "received") !== "received") continue;
    if (d.ticker && hiddenTickers.has(d.ticker)) continue;
    const amt = Number(d.net_amount ?? d.amount ?? 0);
    allTime += amt;
    const paid = (d.payment_date ?? d.pay_date) as string | null;
    if (paid && taxYearOf(paid) === thisTaxYear) thisYear += amt;
  }
  const next = (nextRes.data ?? [])
    .map((e) => ({
      ticker: e.ticker as string,
      status: e.status as string,
      date: ((e.payment_date ?? e.estimated_payment_start) as string | null) ?? null,
      amount: e.net_expected !== null ? Number(e.net_expected) : e.gross_expected !== null ? Number(e.gross_expected) : null,
    }))
    .filter((e) => e.date && e.date >= today && !hiddenTickers.has(e.ticker))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string))[0] ?? null;
  return { thisYear, allTime, taxYear: thisTaxYear, next };
}

/** The ISO date n days before now. Module scope: this page is a server
 * component, but reading the clock is impure either way, so it is kept out of
 * the render body. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dailyPerformance, profileRes] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDailyHoldingPerformance(supabase, user.id),
    supabase.from("profiles").select("demo_mode, full_name, enabled_features").eq("id", user.id).maybeSingle(),
  ]);
  const enabled = normalizeEnabledFeatures(profileRes.data?.enabled_features);
  const importEnabled = enabled.includes("/import");
  const newsEnabled = enabled.includes("/news");

  if (summary.holdingsCount === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-12">
        <p className="eyebrow">Get started</p>
        <h1 className="mt-1.5 font-display text-3xl font-normal tracking-editorial text-text-strong">Home</h1>
        <EmptyState
          icon={Briefcase}
          title="Add what you own"
          description="Enter the shares you hold and the platform will track their value, dividends and allocation from here."
          action={
            <div className="flex flex-col items-center gap-3">
              <AddTransactionDialog label="Add a holding" variant="default" />
              {importEnabled && (
                <Link href="/import" className="text-xs font-medium text-text-muted underline-offset-2 hover:text-text-strong hover:underline">
                  Import a broker statement
                </Link>
              )}
            </div>
          }
        />
      </div>
    );
  }

  const isDemo = Boolean(profileRes.data?.demo_mode);
  const tickers = summary.holdings.map((h) => h.ticker);
  const liveValue = summary.totalValue + summary.cashBalance;
  const hiddenTickers = new Set(summary.hiddenHoldings.map((h) => h.ticker));

  const [series, sparks, dividends] = await Promise.all([
    getBenchmarkSeries(supabase, user.id, liveValue),
    getSparks(supabase, tickers),
    getDividendSummary(supabase, user.id, hiddenTickers),
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
  const yearAgo = isoDaysAgo(365);
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
      avg: h.costUnknown ? null : (h.avg_cost ?? null),
      costUnknown: h.costUnknown,
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

  const unknownCostCount = summary.holdings.filter((h) => h.costUnknown).length;
  const dayTone = dayPnl !== null && dayPnl > 0 ? "text-up" : dayPnl !== null && dayPnl < 0 ? "text-down" : "text-text-strong";

  return (
    // Staggers the direct children — the bands — as the page arrives, once per
    // session. Applied to the stack rather than to each band, so adding or
    // reordering a band needs no delay class and cannot end up with two the
    // same.
    <Cascade className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
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
                <span className="figure font-semibold"><AnimatedMoney value={summary.totalValue} currency={false} decimals={0} /></span>
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
                  {fmtSigned(dayPnl)} ({formatSignedPct(dailyPerformance.weightedDayChangePct)})
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
              <AsOf date={latestMarketDate} time={dailyPerformance.snapshotTime} label="Prices delayed, last updated" live />
            </div>
          )}
        </div>

        {isDemo && <p className="relative z-2 mt-5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">Read-only demo: the portfolio data below is seeded for exploration.</p>}

        <div className="relative z-2 -mx-3 mt-7 sm:-mx-4 md:-mx-(--gutter-page)">
          <div className="grid border-y border-rule sm:grid-cols-2 lg:grid-cols-4">
            <HeroMetric label="Total cost" value={formatNumber(summary.totalCost, 0)} sub={unknownCostCount > 0 ? `PKR, ${unknownCostCount} holding${unknownCostCount === 1 ? "" : "s"} with cost unknown` : "PKR"} first />
            <HeroMetric label="Unrealised P/L" value={fmtSigned(summary.unrealizedPl)} sub={formatSignedPct(summary.unrealizedPlPct)} tone={summary.unrealizedPl > 0 ? "up" : summary.unrealizedPl < 0 ? "down" : undefined} />
            <HeroMetric label="Dividends received" value={formatNumber(summary.dividendIncome, 0)} sub="Since first transaction" />
            <HeroMetric label="Broker cash" value={formatNumber(summary.cashBalance, 0)} sub="Uninvested" last />
          </div>
        </div>
        <p className="relative z-2 py-3 pb-5 text-xs text-text-muted">
          {formatNumber(summary.holdingsCount, 0)} holdings · Largest holding: {summary.largestHolding ? `${summary.largestHolding.ticker}, ${summary.largestHolding.weight?.toFixed(1)}%` : "—"} · Largest sector: {summary.largestSector ? `${shortSector(summary.largestSector.sector)}, ${summary.largestSector.weight.toFixed(1)}%` : "—"}
        </p>
      </Band>

      {/* ── Dividends ── */}
      <Band tone="paper" className={GUTTER}>
        <PanelHeader
          title="Dividends"
          aside={
            <Link href="/dividends" className="text-xs font-medium text-text-muted underline-offset-2 hover:text-text-strong hover:underline">
              All dividends
            </Link>
          }
        />
        <div className="mt-5 grid gap-y-5 sm:grid-cols-3">
          <Metric size="compact" label={`Received, tax year ${dividends.taxYear}`} value={formatNumber(dividends.thisYear, 0)} sub="PKR, net" />
          <Metric size="compact" label="Received, all time" value={formatNumber(dividends.allTime, 0)} sub="PKR, net" />
          {dividends.next ? (
            <Metric
              size="compact"
              label={`Next payout, ${dividends.next.status === "announced" ? "announced" : "expected"}`}
              value={dividends.next.amount !== null ? formatNumber(dividends.next.amount, 0) : dividends.next.ticker}
              sub={`${dividends.next.ticker}, ${dividends.next.date}`}
            />
          ) : (
            <Metric size="compact" label="Next payout" value={<span className="text-text-muted">None on the calendar</span>} />
          )}
        </div>
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
          <AllocationPanel sectors={sectorSlices} holdings={holdingSlices} activeWeights={[]} totalValue={summary.totalValue} />
        </div>

        <div className="mt-9 border-t border-rule pt-7">
          <Suspense fallback={<EventsSkeleton />}>
            <DashboardEvents tickers={tickers} userId={user.id} />
          </Suspense>
          {newsEnabled && (
            <p className="mt-4 text-xs">
              <Link href="/news" className="font-medium text-text-muted underline-offset-2 hover:text-text-strong hover:underline">
                All developments for what you hold
              </Link>
            </p>
          )}
        </div>
      </Band>
      <MarkSeen surface="dashboard" />
    </Cascade>
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
    <Metric
      label={label}
      value={value}
      sub={sub}
      tone={tone}
      className={cn(
        "border-t border-rule px-3 py-4 first:border-t-0 sm:border-t-0 sm:border-l sm:px-6 sm:first:border-l-0",
        first && "md:pl-(--gutter-page)",
        last && "md:pr-(--gutter-page)"
      )}
    />
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
