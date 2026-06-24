import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { cn, formatMoney, formatNumber, formatSignedPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AllocationPie, DailyHoldingPerformanceBar, ValueLine } from "@/components/charts-lazy";
import { ImportantPsxEvents, type PsxEventRow } from "@/components/important-psx-events";
import { SectorChip } from "@/components/sector-chip";
import { Activity, RefreshCw, Sparkles, Upload } from "lucide-react";

// Personalized one-line read on the portfolio, tuned to the user's objective.
const OBJECTIVE_LINE: Record<string, string> = {
  growth: "Here is how your long-term holdings are tracking today.",
  income: "Here is your income and how your payers are doing today.",
  preservation: "Here is your capital and how steadily it is holding today.",
  learning: "Here is your portfolio, explained simply.",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [summary, dailyPerformance, [snapshotsRes, profileRes, psxEventsRes]] = await Promise.all([
    getPortfolio(supabase, user.id),
    getDailyHoldingPerformance(supabase, user.id),
    Promise.all([
      supabase
        .from("portfolio_snapshots")
        .select("snapshot_date, total_value, total_cost")
        .eq("user_id", user.id)
        .order("snapshot_date", { ascending: true })
        .limit(120),
      supabase.from("profiles").select("demo_mode, experience_level, full_name, objective").eq("id", user.id).maybeSingle(),
      supabase
        .from("news_articles")
        .select("id, ticker, title, url, category, published_at")
        .eq("user_id", user.id)
        .eq("ignored", false)
        .in("category", ["dividend", "result", "corporate_announcement"])
        .order("published_at", { ascending: false })
        .limit(8),
    ]),
  ]);

  if (summary.holdingsCount === 0) {
    return (
      <div className="mx-auto max-w-2xl pt-12">
        <PageHeader
          eyebrow="Get started"
          title="Welcome to PortfolioOS PK"
          description="Your private PSX portfolio command center. Nothing here connects to AKD or CDC — you import statements yourself, and all data stays in your account."
        />
        <EmptyState
          icon={Upload}
          title="Your portfolio is empty"
          description="Start by importing an AKD or CDC statement (CSV, Excel or PDF), or load demo data to explore every feature first."
          action={
            <div className="flex flex-col items-center gap-3">
              <div className="flex gap-2">
                <Link href="/import">
                  <Button>
                    <Upload className="h-4 w-4" /> Import a statement
                  </Button>
                </Link>
                <ActionButton endpoint="/api/demo" label={<><Sparkles className="h-4 w-4" /> Load demo data</>} variant="outline" />
              </div>
              <p className="text-[11px] text-muted-foreground">Demo data is clearly marked and can be cleared from Settings at any time.</p>
            </div>
          }
        />
      </div>
    );
  }

  const lean = profileRes.data?.experience_level === "beginner";
  const firstName = (profileRes.data?.full_name ?? "").trim().split(/\s+/)[0] || null;
  const objectiveLine = OBJECTIVE_LINE[profileRes.data?.objective ?? ""] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const priced = summary.holdings.filter((h) => h.unrealized_pl_pct !== null);
  const topGainers = [...priced]
    .sort((a, b) => b.unrealized_pl_pct! - a.unrealized_pl_pct!)
    .filter((h) => h.unrealized_pl_pct! > 0)
    .slice(0, 5);
  const topLosers = [...priced]
    .sort((a, b) => a.unrealized_pl_pct! - b.unrealized_pl_pct!)
    .filter((h) => h.unrealized_pl_pct! < 0)
    .slice(0, 5);
  const psxEvents = (psxEventsRes.data ?? []) as PsxEventRow[];
  const dailyTone =
    dailyPerformance.totalDayPnl !== null && dailyPerformance.totalDayPnl > 0
      ? "positive"
      : dailyPerformance.totalDayPnl !== null && dailyPerformance.totalDayPnl < 0
        ? "negative"
        : "flat";
  const dailyImpact = dailyPerformance.biggestImpact;
  const dailySentence =
    dailyPerformance.rows.length === 0
      ? "Import holdings to see a daily position-by-position performance map."
      : dailyPerformance.totalDayPnl === null
        ? "Daily PSX quotes are not yet available for your holdings."
        : `${dailyPerformance.gainers} holding${dailyPerformance.gainers === 1 ? "" : "s"} up, ${dailyPerformance.losers} down. Your priced holdings ${dailyTone === "positive" ? "added" : dailyTone === "negative" ? "lost" : "were flat at"} ${formatMoney(Math.abs(dailyPerformance.totalDayPnl))} today${dailyPerformance.weightedDayChangePct !== null ? `, a weighted move of ${formatSignedPct(dailyPerformance.weightedDayChangePct)}` : ""}.`;

  // Thesis reviews only surface once the user has written at least one thesis.
  const needsReview = summary.holdings.filter(
    (h) => h.has_thesis && ((h.review_date && h.review_date <= today) || h.thesis_status === "Weakening" || h.thesis_status === "Broken")
  );
  const upcomingReviews = summary.holdings
    .filter((h) => h.review_date && h.review_date > today)
    .sort((a, b) => (a.review_date! < b.review_date! ? -1 : 1))
    .slice(0, 5);

  return (
    <div className="space-y-5">
      {/* Hero */}
      <header className="rise mb-2">
        <p className="eyebrow">
          {firstName ? `Welcome back, ${firstName}` : "Overview"} · {today}
          {profileRes.data?.demo_mode ? " · demo mode" : ""}
        </p>
        {objectiveLine && <p className="mt-1 text-sm text-muted-foreground">{objectiveLine}</p>}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-ghost text-sm font-medium tracking-editorial">Total portfolio value</p>
            <h1 className="mt-1 text-3xl font-medium tabular-nums tracking-editorial sm:text-5xl">
              {formatMoney(summary.totalValue)}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {summary.unrealizedPlPct !== null ? (
                <span
                  className={
                    summary.unrealizedPl > 0
                      ? "font-medium text-emerald-600"
                      : summary.unrealizedPl < 0
                        ? "font-medium text-red-600"
                        : "font-medium"
                  }
                >
                  {formatSignedPct(summary.unrealizedPlPct)} ({formatMoney(summary.unrealizedPl)})
                </span>
              ) : (
                <span className="font-medium">Awaiting prices</span>
              )}{" "}
              unrealized · {formatNumber(summary.holdingsCount, 0)} holdings · {formatMoney(summary.cashBalance)} cash
            </p>
          </div>
          <div className="scroll-touch -mx-1 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
            <ActionButton
              endpoint="/api/dividends/daily"
              label={<><RefreshCw className="h-3.5 w-3.5" /> Run daily update</>}
              variant="default"
              size="sm"
            />
            <ActionButton
              endpoint="/api/ai/briefing"
              body={{ type: "daily" }}
              label={<><Sparkles className="h-4 w-4" /> Generate briefing</>}
              variant="outline"
              size="sm"
            />
          </div>
        </div>
      </header>

      {profileRes.data?.demo_mode && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo mode: holdings, prices and news below are illustrative sample data. Clear it from Settings after importing your real statements.
        </p>
      )}

      {/* Today's holdings move — hidden for beginners */}
      {!lean && (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border bg-muted/20 p-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Today&apos;s move
              </CardTitle>
              <CardDescription className="mt-1 max-w-3xl leading-relaxed">
                {dailySentence}
                {dailyImpact && dailyImpact.dayPnl !== null ? (
                  <> Biggest mover: <strong>{dailyImpact.ticker}</strong>, contributing {formatMoney(dailyImpact.dayPnl)}.</>
                ) : null}
              </CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0 tabular-nums">
              {dailyPerformance.asOf ?? "No market date"}
            </Badge>
          </CardHeader>
          <CardContent className="p-4">
            <div className="mb-3 grid gap-2 text-xs sm:grid-cols-4">
              <MetricTile
                label="Today P/L"
                value={formatMoney(dailyPerformance.totalDayPnl)}
                tone={dailyTone === "positive" ? "positive" : dailyTone === "negative" ? "negative" : undefined}
              />
              <MetricTile label="Weighted move" value={formatSignedPct(dailyPerformance.weightedDayChangePct)} />
              <MetricTile label="Breadth" value={`${dailyPerformance.gainers} up / ${dailyPerformance.losers} down`} />
              <MetricTile
                label="Best stock"
                value={dailyPerformance.best ? `${dailyPerformance.best.ticker} ${formatSignedPct(dailyPerformance.best.dayChangePct)}` : "—"}
              />
            </div>
            {dailyPerformance.rows.length > 0 && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
                <DailyHoldingPerformanceBar
                  data={dailyPerformance.rows.map((row) => ({
                    ticker: row.ticker,
                    dayPnl: row.dayPnl,
                    dayChangePct: row.dayChangePct,
                    marketValue: row.marketValue,
                  }))}
                />
                <div className="scroll-touch divide-y divide-border rounded-lg border border-border bg-card max-h-75 overflow-y-auto md:max-h-97.5">
                  {dailyPerformance.rows.map((row) => {
                    const rowTone = row.dayPnl !== null && row.dayPnl > 0 ? "positive" : row.dayPnl !== null && row.dayPnl < 0 ? "negative" : "flat";
                    return (
                      <Link
                        key={row.ticker}
                        href={`/stocks/${row.ticker}`}
                        className="grid gap-2 p-3 text-xs transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_auto]"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="font-semibold">{row.ticker}</span>
                            {row.sector && <SectorChip sector={row.sector} size="xs" />}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.companyName ?? "—"}</p>
                        </div>
                        <div className="text-left sm:text-right">
                          <p
                            className={cn(
                              "font-semibold tabular-nums",
                              rowTone === "positive" ? "text-emerald-600" : rowTone === "negative" ? "text-red-600" : "text-muted-foreground"
                            )}
                          >
                            {formatMoney(row.dayPnl)}
                          </p>
                          <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                            {formatSignedPct(row.dayChangePct)} · {row.price !== null ? formatNumber(row.price, 2) : "no price"}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
            {dailyPerformance.rows.length === 0 && (
              <EmptyState icon={Activity} title="No holdings to map" description="After you import holdings, this section will show every stock's daily move." />
            )}
          </CardContent>
        </Card>
      )}

      {/* Snapshot stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Total cost"
          value={formatMoney(summary.totalCost)}
          sub={summary.pricedHoldings < summary.holdingsCount ? `${summary.holdingsCount - summary.pricedHoldings} at cost` : undefined}
        />
        <StatCard
          label="Unrealized P/L"
          value={formatMoney(summary.unrealizedPl)}
          sub={summary.unrealizedPlPct !== null ? formatSignedPct(summary.unrealizedPlPct) : "needs prices"}
          tone={summary.unrealizedPl > 0 ? "positive" : summary.unrealizedPl < 0 ? "negative" : "neutral"}
        />
        <StatCard label="Dividend income" value={formatMoney(summary.dividendIncome)} />
        <StatCard label="Cash" value={formatMoney(summary.cashBalance)} />
        <StatCard label="Holdings" value={formatNumber(summary.holdingsCount, 0)} />
        <div className="hidden lg:contents">
          <StatCard
            label="Largest holding"
            value={summary.largestHolding?.ticker ?? "—"}
            sub={summary.largestHolding?.weight ? `${summary.largestHolding.weight.toFixed(1)}% of portfolio` : undefined}
          />
          <StatCard
            label="Largest sector"
            value={summary.largestSector?.sector ?? "—"}
            sub={summary.largestSector ? `${summary.largestSector.weight.toFixed(1)}%` : undefined}
          />
        </div>
      </div>

      {/* Official PSX events */}
      <ImportantPsxEvents events={psxEvents} />

      {/* Gainers / Losers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top gainers</CardTitle>
            <CardDescription>By unrealized return on cost</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {topGainers.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No priced gains yet.</p>}
            {topGainers.map((h) => (
              <Link key={h.ticker} href={`/stocks/${h.ticker}`} className="flex items-center justify-between rounded-md px-1 py-1 text-xs transition-colors hover:bg-muted/50">
                <span className="font-medium">{h.ticker}</span>
                <span className="tabular-nums">
                  <span className="font-semibold text-emerald-600">{formatSignedPct(h.unrealized_pl_pct!)}</span>
                  <span className="ml-2 text-muted-foreground">{formatNumber(h.unrealized_pl ?? 0, 0)}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Biggest declines</CardTitle>
            <CardDescription>Positions below your cost</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {topLosers.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No positions below cost.</p>}
            {topLosers.map((h) => (
              <Link key={h.ticker} href={`/stocks/${h.ticker}`} className="flex items-center justify-between rounded-md px-1 py-1 text-xs transition-colors hover:bg-muted/50">
                <span className="font-medium">{h.ticker}</span>
                <span className="tabular-nums">
                  <span className="font-semibold text-red-600">{formatSignedPct(h.unrealized_pl_pct!)}</span>
                  <span className="ml-2 text-muted-foreground">{formatNumber(h.unrealized_pl ?? 0, 0)}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Allocation + value over time */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By stock</CardTitle>
          </CardHeader>
          <CardContent>
            <AllocationPie data={summary.holdings.map((h) => ({ name: h.ticker, value: h.market_value ?? h.total_cost }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">By sector</CardTitle>
          </CardHeader>
          <CardContent>
            <AllocationPie palette="sector" data={summary.sectorWeights.map((s) => ({ name: s.sector, value: s.value }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Portfolio value over time</CardTitle>
          <CardDescription>Snapshots taken on imports and price updates.</CardDescription>
        </CardHeader>
        <CardContent>
          <ValueLine
            data={(snapshotsRes.data ?? []).map((s) => ({
              date: s.snapshot_date.slice(5),
              value: Number(s.total_value),
              cost: Number(s.total_cost),
            }))}
          />
        </CardContent>
      </Card>

      {/* Thesis reviews — only show when the user has written theses */}
      {!lean && (needsReview.length > 0 || upcomingReviews.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {needsReview.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Theses requiring review</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {needsReview.map((h) => (
                  <Link key={h.ticker} href={`/stocks/${h.ticker}`} className="flex items-center justify-between rounded-md px-1 py-1 text-xs transition-colors hover:bg-muted/50">
                    <span className="font-medium">{h.ticker}</span>
                    <span className="text-muted-foreground">
                      {h.review_date && h.review_date <= today ? "review due" : `thesis ${h.thesis_status?.toLowerCase()}`}
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {upcomingReviews.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Upcoming review dates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {upcomingReviews.map((h) => (
                  <div key={h.ticker} className="flex items-center justify-between px-1 py-1 text-xs">
                    <span className="font-medium">{h.ticker}</span>
                    <span className="text-muted-foreground">{h.review_date}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// Small metric tile used inside the Today's move card
function MetricTile({ label, value, tone }: { label: string; value: string | null; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-600" : "text-foreground"
        )}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}
