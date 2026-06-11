import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getPortfolio } from "@/lib/portfolio";
import { getDividends, summarizeDividends } from "@/lib/dividends";
import { getTaxSettings } from "@/lib/dividends/tax";
import { normalizeEvent, type DividendEvent } from "@/lib/dividends/engine";
import { formatMoney, formatNumber, formatSignedPct } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { AllocationPie, GainLossBar, TargetVsActualBar, ValueLine } from "@/components/charts-lazy";
import { UpcomingIncome } from "@/components/upcoming-income";
import { ImportantPsxEvents, type PsxEventRow } from "@/components/important-psx-events";
import { DailyChangelog, type ChangelogRow } from "@/components/daily-changelog";
import { ArrowRight, FileText, HandCoins, Newspaper, RefreshCw, Sparkles, Upload } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const [
    summary,
    [briefingRes, newsRes, alertsRes, snapshotsRes, batchesRes, profileRes, psxEventsRes, changelogRes],
    dividends,
    dividendEventsRes,
    taxSettings,
  ] = await Promise.all([
    getPortfolio(supabase, user.id),
    Promise.all([
      supabase
        .from("ai_briefings")
        .select("id, title, content, created_at, briefing_type")
        .eq("user_id", user.id)
        .in("briefing_type", ["daily", "weekly"])
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("news_articles")
        .select("id, ticker, title, url, source, sentiment, relevance_score, published_at")
        .eq("user_id", user.id)
        .eq("ignored", false)
        .eq("low_confidence", false)
        .gte("relevance_score", 7)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("alerts")
        .select("id, ticker, alert_type, severity, title")
        .eq("user_id", user.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("portfolio_snapshots")
        .select("snapshot_date, total_value, total_cost")
        .eq("user_id", user.id)
        .order("snapshot_date", { ascending: true })
        .limit(120),
      supabase
        .from("import_batches")
        .select("id, statement_type, status, accepted_rows, rejected_rows, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase.from("profiles").select("demo_mode").eq("id", user.id).maybeSingle(),
      // Important PSX events: official filings (dividends, results, corporate actions)
      supabase
        .from("news_articles")
        .select("id, ticker, title, url, category, published_at")
        .eq("user_id", user.id)
        .eq("ignored", false)
        .in("category", ["dividend", "result", "corporate_announcement"])
        .order("published_at", { ascending: false })
        .limit(8),
      // Latest "what changed" digest
      supabase
        .from("portfolio_changelog")
        .select("run_date, highlights")
        .eq("user_id", user.id)
        .order("run_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]),
    getDividends(supabase, user.id),
    supabase
      .from("dividend_events")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["announced", "expected", "overdue", "needs_review", "forecasted"])
      .order("created_at", { ascending: false })
      .limit(100),
    getTaxSettings(supabase, user.id),
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
          description="Start by importing an AKD/CDC statement (CSV, Excel or PDF), or load demo data to explore every feature first."
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

  const briefing = briefingRes.data?.[0] ?? null;
  const today = new Date().toISOString().slice(0, 10);
  // Thesis review prompts only appear once the user has started writing theses.
  const needsReview = summary.holdings.filter(
    (h) => h.has_thesis && ((h.review_date && h.review_date <= today) || h.thesis_status === "Weakening" || h.thesis_status === "Broken")
  );
  const upcomingReviews = summary.holdings
    .filter((h) => h.review_date && h.review_date > today)
    .sort((a, b) => (a.review_date! < b.review_date! ? -1 : 1))
    .slice(0, 5);
  const priced = summary.holdings.filter((h) => h.unrealized_pl_pct !== null);
  const topGainers = [...priced]
    .sort((a, b) => b.unrealized_pl_pct! - a.unrealized_pl_pct!)
    .filter((h) => h.unrealized_pl_pct! > 0)
    .slice(0, 5);
  const topLosers = [...priced]
    .sort((a, b) => a.unrealized_pl_pct! - b.unrealized_pl_pct!)
    .filter((h) => h.unrealized_pl_pct! < 0)
    .slice(0, 5);
  const latestNews = newsRes.data ?? [];
  const openAlerts = alertsRes.data ?? [];
  const dividendSummary = summarizeDividends(dividends);
  const dividendEvents: DividendEvent[] = (dividendEventsRes.data ?? []).map((r) =>
    normalizeEvent(r as Record<string, unknown>)
  );
  const psxEvents = (psxEventsRes.data ?? []) as PsxEventRow[];
  const changelog = (changelogRes.data as ChangelogRow | null) ?? null;
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description={`Portfolio status as of ${today}${profileRes.data?.demo_mode ? " — demo mode is active" : ""}`}
        actions={
          <>
            <ActionButton
              endpoint="/api/dividends/daily"
              label={<><RefreshCw className="h-3.5 w-3.5" /> Run daily update</>}
              variant="default"
              size="sm"
            />
            <ActionButton
              endpoint="/api/ai/briefing"
              body={{ type: "daily" }}
              label={<><Sparkles className="h-4 w-4" /> Generate daily briefing</>}
              variant="outline"
              size="sm"
            />
          </>
        }
      />

      {profileRes.data?.demo_mode && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo mode: holdings, prices and news below are illustrative sample data. Clear it from Settings after importing your real statements.
        </p>
      )}

      <DailyChangelog changelog={changelog} today={today} />

      {/* 1. Portfolio Snapshot */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Total value"
          value={formatMoney(summary.totalValue)}
          sub={summary.pricedHoldings < summary.holdingsCount ? `${summary.holdingsCount - summary.pricedHoldings} holding(s) priced at cost` : undefined}
        />
        <StatCard label="Total cost" value={formatMoney(summary.totalCost)} />
        <StatCard
          label="Unrealized P/L"
          value={formatMoney(summary.unrealizedPl)}
          sub={summary.unrealizedPlPct !== null ? formatSignedPct(summary.unrealizedPlPct) : "needs prices"}
          tone={summary.unrealizedPl > 0 ? "positive" : summary.unrealizedPl < 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Realized P/L"
          value={formatMoney(summary.realizedPl)}
          tone={summary.realizedPl > 0 ? "positive" : summary.realizedPl < 0 ? "negative" : "neutral"}
        />
        <StatCard label="Dividend income" value={formatMoney(summary.dividendIncome)} />
        <StatCard label="Expected dividends" value={formatMoney(summary.expectedDividendIncome)} sub={`${summary.pendingDividends} pending`} />
        <StatCard label="Cash balance" value={formatMoney(summary.cashBalance)} sub="from imported cash movements" />
        <StatCard label="Holdings" value={formatNumber(summary.holdingsCount, 0)} />
        <StatCard
          label="Largest holding"
          value={summary.largestHolding?.ticker ?? "—"}
          sub={summary.largestHolding?.weight ? `${summary.largestHolding.weight.toFixed(1)}% of portfolio` : undefined}
        />
        <StatCard
          label="Largest sector"
          value={summary.largestSector?.sector ?? "—"}
          sub={summary.largestSector ? `${summary.largestSector.weight.toFixed(1)}% of portfolio` : undefined}
        />
        <StatCard
          label="Open alerts"
          value={formatNumber(alertsRes.data?.length ?? 0, 0)}
          tone={(alertsRes.data?.length ?? 0) > 0 ? "negative" : "neutral"}
        />
      </div>

      {/* 2. Upcoming Income */}
      <UpcomingIncome events={dividendEvents} today={today} />

      {/* 3. Important PSX Events */}
      <ImportantPsxEvents events={psxEvents} />

      {/* 4. Top Gainers / Losers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Top gainers</CardTitle>
            <CardDescription>By unrealized return on cost</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {topGainers.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No priced gains yet.</p>}
            {topGainers.map((h) => (
              <Link key={h.ticker} href={`/stocks/${h.ticker}`} className="flex items-center justify-between text-xs hover:underline">
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
          <CardHeader>
            <CardTitle>Biggest declines</CardTitle>
            <CardDescription>Positions trading below your cost</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {topLosers.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">No positions below cost.</p>}
            {topLosers.map((h) => (
              <Link key={h.ticker} href={`/stocks/${h.ticker}`} className="flex items-center justify-between text-xs hover:underline">
                <span className="font-medium">{h.ticker}</span>
                <span className="tabular-nums">
                  <span className="font-semibold text-red-600">{formatSignedPct(h.unrealized_pl_pct!)}</span>
                  <span className="ml-2 text-muted-foreground">{formatNumber(h.unrealized_pl ?? 0, 0)}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Import status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(batchesRes.data ?? []).length === 0 && (
              <p className="py-3 text-center text-xs text-muted-foreground">No imports yet.</p>
            )}
            {(batchesRes.data ?? []).map((b) => (
              <div key={b.id} className="flex items-center justify-between text-xs">
                <span>
                  {b.created_at.slice(0, 10)} · {b.statement_type}
                </span>
                <span className="text-muted-foreground">
                  {b.status === "committed" ? `${b.accepted_rows} rows${b.rejected_rows ? `, ${b.rejected_rows} rejected` : ""}` : b.status}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 5. Allocation charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Allocation by stock</CardTitle>
          </CardHeader>
          <CardContent>
            <AllocationPie
              data={summary.holdings.map((h) => ({ name: h.ticker, value: h.market_value ?? h.total_cost }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Allocation by sector</CardTitle>
          </CardHeader>
          <CardContent>
            <AllocationPie data={summary.sectorWeights.map((s) => ({ name: s.sector, value: s.value }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Unrealized gain/loss by holding</CardTitle>
          </CardHeader>
          <CardContent>
            <GainLossBar
              data={summary.holdings
                .filter((h) => h.unrealized_pl !== null)
                .map((h) => ({ ticker: h.ticker, pl: h.unrealized_pl! }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Actual vs target allocation</CardTitle>
          </CardHeader>
          <CardContent>
            <TargetVsActualBar
              data={summary.holdings
                .filter((h) => h.target_allocation !== null)
                .map((h) => ({ ticker: h.ticker, actual: h.weight ?? 0, target: h.target_allocation! }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio value over time</CardTitle>
          <CardDescription>Daily snapshots are taken on imports and price updates.</CardDescription>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-start justify-between border-b border-border bg-muted/30 p-4">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Daily review brief</CardTitle>
                {briefing && <Badge variant="outline">{briefing.briefing_type}</Badge>}
              </div>
              <CardDescription className="mt-1">
                {briefing ? `Generated ${briefing.created_at.slice(0, 16).replace("T", " ")}` : "No briefing generated yet"}
              </CardDescription>
            </div>
            <Link href="/briefings" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
              Open full brief <ArrowRight className="inline h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {briefing ? (
              <div className="grid md:grid-cols-[180px_minmax(0,1fr)]">
                <div className="space-y-3 border-b border-border bg-muted/20 p-4 md:border-b-0 md:border-r">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Coverage</p>
                    <p className="mt-1 text-sm font-semibold">{summary.pricedHoldings}/{summary.holdingsCount} priced</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Open alerts</p>
                    <p className="mt-1 text-sm font-semibold">{openAlerts.length}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">High-relevance news</p>
                    <p className="mt-1 text-sm font-semibold">{latestNews.length}</p>
                  </div>
                </div>
                <div className="max-h-[420px] overflow-y-auto p-4">
                  <Markdown content={briefing.content} className="dashboard-briefing" />
                </div>
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
                <FileText className="h-7 w-7 text-muted-foreground/70" />
                <p className="max-w-md text-sm font-medium">Generate a concise daily review once prices, news, and alerts are up to date.</p>
                <p className="max-w-md text-xs text-muted-foreground">The dashboard will show a compact version here; the full archive stays in Briefings.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <HandCoins className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Dividend snapshot</CardTitle>
              </div>
              <Link href="/dividends" className="text-xs text-muted-foreground hover:text-foreground">
                Dividend Tracker <ArrowRight className="inline h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md border border-border p-2">
                  <p className="text-muted-foreground">Received</p>
                  <p className="mt-1 font-semibold tabular-nums">{formatMoney(dividendSummary.netReceived)}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-muted-foreground">Expected</p>
                  <p className="mt-1 font-semibold tabular-nums">{formatMoney(dividendSummary.expectedNet)}</p>
                </div>
                <div className="rounded-md border border-border p-2">
                  <p className="text-muted-foreground">Pending</p>
                  <p className="mt-1 font-semibold tabular-nums">{dividendSummary.pendingCount}</p>
                </div>
              </div>
              {dividendSummary.topPayers.length === 0 ? (
                <p className="py-3 text-center text-xs text-muted-foreground">No dividend records yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {dividendSummary.topPayers.slice(0, 4).map((d) => (
                    <Link key={d.ticker} href={`/stocks/${d.ticker}`} className="flex items-center justify-between text-xs hover:underline">
                      <span className="font-medium">{d.ticker}</span>
                      <span className="tabular-nums text-muted-foreground">{formatMoney(d.net)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                <CardTitle>High-relevance news</CardTitle>
              </div>
              <Link href="/news" className="text-xs text-muted-foreground hover:text-foreground">
                News Center <ArrowRight className="inline h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {latestNews.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No high-relevance news stored. Refresh news from the News Center.
                </p>
              )}
              {latestNews.map((n) => (
                <div key={n.id} className="flex items-start gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                  <Badge variant={n.sentiment === "positive" ? "green" : n.sentiment === "negative" ? "red" : "secondary"}>
                    {n.ticker ?? "—"}
                  </Badge>
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="min-w-0 text-xs leading-snug hover:underline">
                    {n.title}
                    <span className="ml-1 text-muted-foreground">({n.source})</span>
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {(needsReview.length > 0 || upcomingReviews.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {needsReview.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Theses requiring review</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {needsReview.map((h) => (
                  <Link key={h.ticker} href={`/stocks/${h.ticker}`} className="flex items-center justify-between text-xs hover:underline">
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
              <CardHeader>
                <CardTitle>Upcoming review dates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {upcomingReviews.map((h) => (
                  <div key={h.ticker} className="flex items-center justify-between text-xs">
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
