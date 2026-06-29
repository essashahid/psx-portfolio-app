import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/admin/guard";
import { getBullsBears, type BudgetImpact, type BucketRow, type EarningsQualityFlag, type EnrichedTradeSetup, type PortfolioStrategyRow } from "@/lib/market/bulls-bears";
import type { ScoredStock } from "@/lib/market/score";
import { BUCKET_META, type SectorBucket } from "@/lib/market/sectors";
import type { CallReview, Direction, MacroIndicator, WatchItem } from "@/lib/market/weekly-brief";
import { fmtInt, fmtPct, tone } from "@/lib/market/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { ScoreBoard } from "@/components/market/score-board";
import { PortfolioStrategyChart, RegimeRotationChart, ScoreMomentumMap, SetupRiskRewardChart } from "@/components/market/bulls-bears-visuals";
import { ForeignFlows } from "@/components/market/foreign-flows";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Flame,
  Gauge,
  Landmark,
  LineChart,
  ListChecks,
  RefreshCw,
  Shield,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Globe2,
} from "lucide-react";

export const dynamic = "force-dynamic";

const BUCKET_ORDER: SectorBucket[] = ["energy", "cyclical", "defensive", "financials", "other"];

const BUCKET_ICON: Record<SectorBucket, typeof Activity> = {
  energy: Flame,
  cyclical: TrendingUp,
  defensive: Shield,
  financials: Landmark,
  other: Building2,
};


export default async function BullsBearsPage() {
  const { isAdmin } = await getAdminContext();
  if (!isAdmin) redirect("/dashboard");

  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const data = await getBullsBears(supabase, user.id);
  const topOwned = data.topPicks.filter((s) => data.ownedTickers.has(s.ticker)).slice(0, 6);
  const flagged = data.earningsQuality;
  const referenceDate = new Date(data.brief.recordedOn).toLocaleDateString("en-PK", {
    timeZone: "Asia/Karachi",
    dateStyle: "medium",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PSX - Bulls & Bears"
        title="Bulls & Bears"
        description="A weekly transcript-driven market cockpit: recap, regime, Sarmaya-style scoring, earnings quality, and budget impact mapped to your portfolio."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Reference: {referenceDate}</Badge>
            <Link href="/market" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted">
              <RefreshCw className="h-3.5 w-3.5" />
              Market Pulse
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
        <Card className="rise overflow-hidden border-zinc-300">
          <CardContent className="grid gap-5 p-5 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="flex flex-col justify-between gap-5">
              <div>
                <p className="eyebrow">This week&apos;s brief</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-editorial">{data.brief.episode}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {data.brief.regime.note}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <HeroMetric label="Weekly index move" value={fmtPct(data.brief.marketRecap.weeklyChangePct)} tone={tone(data.brief.marketRecap.weeklyChangePct)} />
                <HeroMetric label="Live scored universe" value={fmtInt(data.scoredCount)} sub={`${fmtInt(data.marketCount)} in market snapshot`} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {data.brief.topDevelopments.map((item, index) => (
                <div key={item} className="rounded-lg border border-border bg-muted/35 p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-md bg-card text-xs font-semibold tabular-nums">
                    {index + 1}
                  </div>
                  <p className="text-xs leading-relaxed text-foreground/85">{item}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <LiveRecapCard recap={data.recap} />
      </div>

      <AtAGlance data={data} />

      <VisualDecisionMap data={data} />

      <PortfolioStrategyPanel rows={data.portfolioStrategy} />

      <TeamSetupsPanel setups={data.tradeSetups} opportunities={data.topOpportunities} />

      <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <RegimeCard regime={data.regime} favored={data.brief.regime.favored} cautious={data.brief.regime.cautious} />
        <MacroCard macro={data.brief.macro} />
      </div>

      <ForeignFlowCard flow={data.foreignFlow} />

      <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
        <IndexTechnicalCard data={data} />
        <GlobalMarketsCard data={data} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.8fr_1.2fr]">
        <BucketLeaders leaders={data.bucketLeaders} />
        <Card className="rise rise-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Sarmaya-style score board</CardTitle>
            <CardDescription>
              Every PSX company ranked 1–{data.scoredCount} by a composite score (0–100). Higher = more fundamentally attractive right now. The score blends five things the show always checks: <strong>Growth</strong> (is EPS/revenue rising?), <strong>Quality</strong> (strong margins, low debt?), <strong>Value</strong> (is it cheap?), <strong>Momentum</strong> (is the price above its moving averages?), and <strong>Income</strong> (dividend yield + cover). Click any row to see the full breakdown. Filter by sector bucket or &quot;Owned&quot; to focus on what matters to you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.topPicks.length ? (
              <ScoreBoard stocks={data.topPicks} owned={[...data.ownedTickers]} />
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No scored companies yet"
                description="The score board needs cached company ratios and technicals. Once the data engine has refreshed those caches, this section will rank the market."
              />
            )}
          </CardContent>
        </Card>
      </div>

      {topOwned.length > 0 && (
        <Card className="rise border-emerald-100">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-emerald-600" /> Your holdings inside the top 50</CardTitle>
            <CardDescription>Owned names that also make the current score shortlist.</CardDescription>
          </CardHeader>
          <CardContent>
            <MiniStockGrid stocks={topOwned} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <EarningsQualityCard flags={flagged} watchlist={data.brief.watchlist} />
        <BudgetMapper impacts={data.budgetImpacts} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CallReviewCard calls={data.brief.callReview} />
        <SignalNoiseCard signal={data.brief.signalVsNoise.signal} noise={data.brief.signalVsNoise.noise} />
      </div>

      <Card className="rise">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4" /> Weekly source note</CardTitle>
          <CardDescription>{data.brief.source}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">{data.brief.marketRecap.note}</p>
          <p className="mt-3 text-[10px] text-muted-foreground">
            This page is descriptive research tooling, not investment advice. Update <code className="rounded bg-muted px-1 py-0.5">lib/market/weekly-brief.ts</code> each week with the new transcript.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function HeroMetric({ label, value, sub, tone: t }: { label: string; value: string; sub?: string; tone?: "positive" | "negative" | "flat" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", t === "positive" ? "text-emerald-700" : t === "negative" ? "text-red-700" : "text-foreground")}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function LiveRecapCard({ recap }: { recap: Awaited<ReturnType<typeof getBullsBears>>["recap"] }) {
  if (!recap) {
    return (
      <Card className="rise rise-1">
        <CardContent className="p-5">
          <EmptyState icon={Activity} title="No live market recap" description="The weekly brief still renders. Refresh Market Pulse to populate the live PSX snapshot and sector rotation." />
        </CardContent>
      </Card>
    );
  }

  const indexTone = tone(recap.indexChangePct);
  const breadthTotal = recap.advancers + recap.decliners + recap.unchanged || 1;
  const advPct = (recap.advancers / breadthTotal) * 100;
  const decPct = (recap.decliners / breadthTotal) * 100;

  return (
    <Card className="rise rise-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Live market recap</CardTitle>
        <CardDescription>{recap.updatedLabel ? `Updated ${recap.updatedLabel} PKT` : recap.date ?? "Latest PSX snapshot"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="eyebrow">{recap.indexName ?? "Index"}</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="text-3xl font-semibold tabular-nums">{recap.indexValue?.toLocaleString("en-PK", { maximumFractionDigits: 2 }) ?? "-"}</p>
            <p className={cn("flex items-center gap-1 text-sm font-semibold tabular-nums", indexTone === "positive" ? "text-emerald-600" : indexTone === "negative" ? "text-red-600" : "text-muted-foreground")}>
              {indexTone === "positive" ? <ArrowUpRight className="h-4 w-4" /> : indexTone === "negative" ? <ArrowDownRight className="h-4 w-4" /> : null}
              {fmtPct(recap.indexChangePct)}
            </p>
          </div>
        </div>
        <div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-emerald-500" style={{ width: `${advPct}%` }} />
            <div className="h-full bg-zinc-300" style={{ width: `${Math.max(0, 100 - advPct - decPct)}%` }} />
            <div className="h-full bg-red-500" style={{ width: `${decPct}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <SmallStat label="Advancers" value={fmtInt(recap.advancers)} tone="positive" />
            <SmallStat label="Unchanged" value={fmtInt(recap.unchanged)} />
            <SmallStat label="Decliners" value={fmtInt(recap.decliners)} tone="negative" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
          <SmallStat label="Top sector" value={recap.topSector ?? "-"} tone="positive" align="left" />
          <SmallStat label="Weakest sector" value={recap.bottomSector ?? "-"} tone="negative" align="left" />
        </div>
      </CardContent>
    </Card>
  );
}

function SmallStat({ label, value, tone: t, align = "center" }: { label: string; value: string; tone?: "positive" | "negative"; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "text-center" : "min-w-0"}>
      <p className={cn("truncate text-sm font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-foreground")}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function VisualDecisionMap({ data }: { data: Awaited<ReturnType<typeof getBullsBears>> }) {
  return (
    <Card className="rise rise-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Visual decision map</CardTitle>
        <CardDescription>
          Four quick visuals: what your holdings score, which episode setups have attractive risk/reward, where the top-50 stocks sit on score vs momentum, and which sector bucket is leading today.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="mb-1 text-xs font-semibold">Your holdings by show-style verdict</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Bars above 60 are investable screens; color shows whether the next step is add, hold, or review risk.</p>
          <PortfolioStrategyChart rows={data.portfolioStrategy} />
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="mb-1 text-xs font-semibold">Episode setup risk / reward</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Left side is risk to stop; right side is reward to the first target from the suggested entry midpoint.</p>
          <SetupRiskRewardChart setups={data.tradeSetups} />
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="mb-1 text-xs font-semibold">Top 50: score vs momentum</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Upper-right names combine fundamentals and trend. Your owned names are highlighted in green.</p>
          <ScoreMomentumMap stocks={data.topPicks} owned={[...data.ownedTickers]} />
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="mb-1 text-xs font-semibold">Live rotation by bucket</p>
          <p className="mb-2 text-[11px] text-muted-foreground">This is the video’s cyclical / defensive / energy framework applied to today’s PSX sector snapshot.</p>
          {data.regime ? <RegimeRotationChart buckets={data.regime.buckets} /> : <EmptyState icon={Gauge} title="No rotation chart yet" description="Refresh Market Pulse to populate live sector buckets." />}
        </div>
      </CardContent>
    </Card>
  );
}

function PortfolioStrategyPanel({ rows }: { rows: PortfolioStrategyRow[] }) {
  const addRows = rows.filter((row) => row.verdict === "setup_add" || row.verdict === "add_candidate");
  const reviewRows = rows.filter((row) => row.verdict === "risk_review");

  return (
    <Card className="rise rise-2 border-emerald-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-emerald-600" /> What this means for my portfolio</CardTitle>
        <CardDescription>
          This applies the episode’s thinking to stocks you already own: score first, then rotation, setup, budget impact, and earnings quality. It is not a blind buy/sell list; it tells you what deserves research, sizing, or risk review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <EmptyState icon={Briefcase} title="No holdings to map" description="Import holdings and this panel will show which of your stocks match the episode strategy." />
        ) : (
          <>
            <div className="grid gap-2 md:grid-cols-3">
              <DecisionTile icon={CheckCircle2} label="Potential add / add-on" value={addRows.length} tone="positive" />
              <DecisionTile icon={Eye} label="Hold and watch" value={rows.filter((row) => row.verdict === "hold_watch").length} tone="neutral" />
              <DecisionTile icon={AlertTriangle} label="Risk review first" value={reviewRows.length} tone="caution" />
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {rows.map((row) => (
                <div key={row.ticker} className="bg-card p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/stocks/${row.ticker}`} className="text-sm font-semibold hover:underline">{row.ticker}</Link>
                        <VerdictBadge verdict={row.verdict} label={row.verdictLabel} />
                        <Badge variant="outline">{BUCKET_META[row.bucket].label}</Badge>
                        {row.matchedSetup && <Badge variant="blue">Episode setup</Badge>}
                      </div>
                      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-foreground/85">{row.actionSentence}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-right text-[11px]">
                      <MiniLabel label="Score" value={row.score != null ? `${row.score.toFixed(0)} (#${row.rank})` : "—"} />
                      <MiniLabel label="Live" value={row.livePrice != null ? row.livePrice.toFixed(2) : "—"} />
                      <MiniLabel label="P/L" value={fmtPct(row.unrealizedPct)} />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    <ReasonList title="Why it matches" items={row.reasons.slice(0, 4)} tone="positive" />
                    <ReasonList title="What to check first" items={row.risks.length ? row.risks.slice(0, 4) : [`Weakest sub-score: ${row.weakestSubScore ?? "not available"}. Confirm this before sizing up.`]} tone={row.risks.length ? "caution" : "neutral"} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TeamSetupsPanel({ setups, opportunities }: { setups: EnrichedTradeSetup[]; opportunities: ScoredStock[] }) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
      <Card className="rise rise-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Target className="h-4 w-4" /> Team setups for the following week</CardTitle>
          <CardDescription>
            These are the explicit PSX setups discussed after the video’s market outlook. The useful part is not just the ticker; it is the entry, stop, target, catalyst, and caveat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {setups.map((setup) => <TradeSetupRow key={setup.setup.ticker} setup={setup} />)}
        </CardContent>
      </Card>

      <Card className="rise rise-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4" /> What I should research next</CardTitle>
          <CardDescription>
            Top-scoring names you do not currently own, filtered toward the episode’s preferred buckets where possible. Treat these as a research queue, not automatic buys.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {opportunities.length ? (
            <div className="space-y-1">
              {opportunities.slice(0, 10).map((stock) => (
                <Link key={stock.ticker} href={`/stocks/${stock.ticker}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{stock.ticker} <span className="font-normal text-muted-foreground">#{stock.rank}</span></p>
                    <p className="truncate text-[10px] text-muted-foreground">{stock.companyName ?? stock.sector ?? BUCKET_META[stock.bucket].label}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold tabular-nums">{stock.score.toFixed(0)}</p>
                    <p className="text-[10px] text-muted-foreground">{bestSubScore(stock)}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-muted/25 p-3 text-xs text-muted-foreground">No clean non-owned opportunities matched the current score and rotation filters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TradeSetupRow({ setup }: { setup: EnrichedTradeSetup }) {
  const s = setup.setup;
  const targetText = s.targets.map((target) => `${target.label}${target.price != null ? ` ${target.price}` : ""}`).join(" / ");
  const statusVariant: "green" | "red" | "amber" | "blue" = setup.status === "in_entry" ? "green" : setup.status === "invalidated" ? "red" : setup.status === "extended" ? "amber" : "blue";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/stocks/${s.ticker}`} className="text-sm font-semibold hover:underline">{s.ticker}</Link>
            <Badge variant={statusVariant}>{setupStatusLabel(setup.status)}</Badge>
            {setup.owned && <Badge variant="green">You own it</Badge>}
            <Badge variant="outline">{BUCKET_META[s.bucket].label}</Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">
            The team’s plan for {s.ticker} was <strong>{s.setupLabel}</strong>: use {s.entry} as the entry, keep risk defined with stop {s.stop}, then look for {targetText}. {setup.statusText}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right text-[11px]">
          <MiniLabel label="Live" value={setup.livePrice != null ? setup.livePrice.toFixed(2) : "—"} />
          <MiniLabel label="Risk" value={setup.riskPct != null ? fmtPct(-Math.abs(setup.riskPct)) : "—"} />
          <MiniLabel label="T1 reward" value={setup.rewardPct != null ? fmtPct(setup.rewardPct) : "—"} />
        </div>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        <ReasonList title="Technical pattern" items={[s.technicalCase]} tone="neutral" />
        <ReasonList title="Fundamental case" items={[s.fundamentalCase]} tone="positive" />
        <ReasonList title="Caveat" items={[s.caveat ?? "No explicit caveat in the transcript. Still verify current price and filings before acting."]} tone={s.caveat ? "caution" : "neutral"} />
      </div>
    </div>
  );
}

function IndexTechnicalCard({ data }: { data: Awaited<ReturnType<typeof getBullsBears>> }) {
  const map = data.brief.indexTechnicalMap;
  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LineChart className="h-4 w-4" /> Index technical map</CardTitle>
        <CardDescription>
          This is the market context the team used before selecting individual stocks. It tells you when to be aggressive and when to keep risk tight.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="text-sm font-semibold text-emerald-800">Current bias: {map.bias}</p>
          <p className="mt-1 text-xs leading-relaxed text-emerald-950/80">{map.breakoutConfirmation}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <ReasonList title="Bullish evidence" items={map.bullishEvidence} tone="positive" />
          <ReasonList title="Invalidation / risk" items={[...map.bearishInvalidation, `Nearby support/gap: ${map.nearSupport}. Lower gaps: ${map.lowerGaps.join(", ")}.`]} tone="caution" />
        </div>
        <p className="rounded-lg border border-border bg-muted/25 p-3 text-sm leading-relaxed text-foreground/85">{map.playbook}</p>
      </CardContent>
    </Card>
  );
}

function GlobalMarketsCard({ data }: { data: Awaited<ReturnType<typeof getBullsBears>> }) {
  return (
    <Card className="rise rise-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Global market read</CardTitle>
        <CardDescription>
          Global context from the episode, translated into what it means for a PSX investor this week.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.brief.globalMarkets.map((item) => (
          <div key={item.market} className="rounded-lg border border-border bg-muted/25 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{item.market}</p>
              <Badge variant={item.bias.toLowerCase().includes("sell") ? "amber" : item.bias.toLowerCase().includes("support") ? "green" : "outline"}>{item.bias}</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.levels}</p>
            <p className="mt-2 text-xs leading-relaxed text-foreground/85">{item.investorRead}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RegimeCard({ regime, favored, cautious }: { regime: Awaited<ReturnType<typeof getBullsBears>>["regime"]; favored: SectorBucket[]; cautious: SectorBucket[] }) {
  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4" /> Rotation and regime</CardTitle>
        <CardDescription>
          Markets cycle between two modes: <strong>risk-on</strong> (cyclicals like cement, autos, textiles lead — investors are confident) and <strong>risk-off</strong> (defensives like fertilizer, food, pharma lead — investors are cautious). Energy leads separately when oil/commodity prices rise. The bars below show which bucket is actually leading <em>today</em> from live PSX data. The &quot;Brief favored&quot; tags are what the episode specifically called out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {regime ? (
          <>
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{regime.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{regime.note}</p>
                </div>
                {regime.leader && <Badge variant="green">Leader: {BUCKET_META[regime.leader].label}</Badge>}
              </div>
            </div>
            <div className="space-y-2">
              {BUCKET_ORDER.map((bucket) => {
                const row = regime.buckets.find((b) => b.bucket === bucket);
                return <BucketBar key={bucket} bucket={bucket} row={row ?? null} />;
              })}
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">No sector snapshot yet. The reference stance below is from the weekly brief.</p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <BriefBucketList title="Brief favored" buckets={favored} variant="green" />
          <BriefBucketList title="Brief cautious" buckets={cautious} variant="amber" />
        </div>
      </CardContent>
    </Card>
  );
}

function ForeignFlowCard({ flow }: { flow: Awaited<ReturnType<typeof getBullsBears>>["foreignFlow"] }) {
  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-sky-600" /> Foreign money (FIPI / LIPI)</CardTitle>
        <CardDescription>
          The &ldquo;smart money&rdquo; overlay on the rotation read — is foreign capital confirming or fading the sectors that are leading on price?
        </CardDescription>
      </CardHeader>
      <CardContent>
        {flow ? (
          <ForeignFlows snapshot={flow} />
        ) : (
          <EmptyState
            icon={Globe2}
            title="No FIPI / LIPI data yet"
            description="Add the day's NCCPL foreign/local flow numbers in Settings → Foreign flows to overlay smart-money direction on the regime read."
          />
        )}
      </CardContent>
    </Card>
  );
}

function BucketBar({ bucket, row }: { bucket: SectorBucket; row: BucketRow | null }) {
  const Icon = BUCKET_ICON[bucket];
  const value = row?.avgReturn ?? null;
  const abs = value == null ? 0 : Math.min(100, Math.abs(value) * 14);
  const t = tone(value);

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-[170px_1fr_86px] sm:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", bucketToneClass(bucket))}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{BUCKET_META[bucket].label}</p>
          <p className="text-[10px] text-muted-foreground">{row ? `${fmtInt(row.stockCount)} stocks` : "No data"}</p>
        </div>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", t === "positive" ? "bg-emerald-500" : t === "negative" ? "bg-red-500" : "bg-zinc-400")}
            style={{ width: `${Math.max(4, abs)}%` }}
          />
        </div>
        {row?.topSector && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Top: {row.topSector} {fmtPct(row.topSectorReturn)}
          </p>
        )}
      </div>
      <div className="text-right">
        <p className={cn("text-sm font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-foreground")}>{fmtPct(value)}</p>
        {row && <p className="text-[10px] text-muted-foreground">{row.advancers} up / {row.decliners} down</p>}
      </div>
    </div>
  );
}

function BriefBucketList({ title, buckets, variant }: { title: string; buckets: SectorBucket[]; variant: "green" | "amber" }) {
  return (
    <div className="rounded-lg border border-border bg-muted/25 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {buckets.length ? buckets.map((bucket) => (
          <Badge key={bucket} variant={variant}>{BUCKET_META[bucket].label}</Badge>
        )) : <span className="text-xs text-muted-foreground">None called out</span>}
      </div>
    </div>
  );
}

function MacroCard({ macro }: { macro: MacroIndicator[] }) {
  return (
    <Card className="rise rise-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LineChart className="h-4 w-4" /> Macro dashboard</CardTitle>
        <CardDescription>Transcript indicators, tagged by directional read.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {macro.map((m) => (
            <div key={m.label} className="rounded-lg border border-border bg-muted/25 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold">{m.label}</p>
                <DirectionBadge direction={m.direction} />
              </div>
              <p className="mt-1 text-sm font-semibold tabular-nums">{m.value}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{m.note}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BucketLeaders({ leaders }: { leaders: Record<SectorBucket, ScoredStock[]> }) {
  return (
    <Card className="rise rise-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Target className="h-4 w-4" /> Best scored by bucket</CardTitle>
        <CardDescription>The top names in each regime bucket, using the composite score.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {BUCKET_ORDER.map((bucket) => {
          const stocks = leaders[bucket] ?? [];
          const Icon = BUCKET_ICON[bucket];
          return (
            <div key={bucket}>
              <div className="mb-1.5 flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold">{BUCKET_META[bucket].label}</p>
              </div>
              {stocks.length ? (
                <div className="space-y-1">
                  {stocks.slice(0, 3).map((s) => (
                    <Link key={s.ticker} href={`/stocks/${s.ticker}`} className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold">{s.ticker}</span>
                        <span className="ml-2 text-[10px] text-muted-foreground">{s.sector ?? s.companyName ?? ""}</span>
                      </div>
                      <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-bold tabular-nums text-background">{s.score.toFixed(0)}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="rounded-md bg-muted/40 px-2 py-2 text-xs text-muted-foreground">No scored names.</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MiniStockGrid({ stocks }: { stocks: ScoredStock[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {stocks.map((s) => (
        <Link key={s.ticker} href={`/stocks/${s.ticker}`} className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/40">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{s.ticker}</p>
              <p className="truncate text-[11px] text-muted-foreground">{s.companyName ?? s.sector ?? ""}</p>
            </div>
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">{s.score.toFixed(0)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Rank #{s.rank}</span>
            <span className={cn("font-semibold tabular-nums", tone(s.changePercent) === "positive" ? "text-emerald-600" : tone(s.changePercent) === "negative" ? "text-red-600" : "text-muted-foreground")}>{fmtPct(s.changePercent)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function EarningsQualityCard({ flags, watchlist }: { flags: EarningsQualityFlag[]; watchlist: WatchItem[] }) {
  const cautionItems = watchlist.filter((w) => w.caution);

  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Earnings quality</CardTitle>
        <CardDescription>
          Not all earnings growth is real. A <strong>base effect</strong> means last year was unusually bad, so this year looks great by comparison — but it&apos;s not true improvement. A <strong>one-time gain</strong> (e.g. selling an asset, a demerger windfall) inflates EPS for one quarter only. The show always asks: &quot;Is this recurring?&quot; These flags catch the cases where the answer is probably no.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {flags.length ? (
          <div className="space-y-2">
            {flags.slice(0, 8).map((flag) => (
              <div key={flag.ticker} className="rounded-lg border border-amber-200 bg-amber-50/55 p-3">
                <Badge variant="amber">{flag.ticker} - {qualityLabel(flag.badge)}</Badge>
                <p className="mt-2 text-xs leading-relaxed text-amber-900/80">{flag.caption}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-muted/25 p-3 text-xs text-muted-foreground">No rule-based earnings quality flags in the current top 50.</p>
        )}

        {cautionItems.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Transcript cautions</p>
            <div className="space-y-2">
              {cautionItems.map((item) => (
                <div key={item.ticker} className="rounded-lg border border-border bg-muted/25 p-3">
                  <p className="text-xs font-semibold">{item.ticker}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.caution}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetMapper({ impacts }: { impacts: BudgetImpact[] }) {
  const touched = impacts.filter((impact) => impact.holdings.length > 0);

  return (
    <Card className="rise rise-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Budget mapper</CardTitle>
        <CardDescription>Policy items from the weekly brief, mapped to sectors and your holdings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {touched.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/55 p-3">
            <p className="text-xs font-semibold text-emerald-800">Your portfolio has direct matches</p>
            <p className="mt-1 text-xs text-emerald-900/75">
              {touched.length} policy item{touched.length === 1 ? "" : "s"} matched at least one holding by sector keywords.
            </p>
          </div>
        )}
        <div className="grid gap-2">
          {impacts.map((impact) => <PolicyRow key={impact.item.policy} impact={impact} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function PolicyRow({ impact }: { impact: BudgetImpact }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{impact.item.policy}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{impact.item.detail}</p>
        </div>
        <DirectionBadge direction={impact.item.direction} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {impact.item.buckets.map((bucket) => <Badge key={bucket} variant="outline">{BUCKET_META[bucket].label}</Badge>)}
        {impact.holdings.map((ticker) => <Badge key={ticker} variant="green">{ticker}</Badge>)}
        {impact.item.buckets.length === 0 && impact.holdings.length === 0 && <span className="text-[11px] text-muted-foreground">No direct sector mapping</span>}
      </div>
    </div>
  );
}

function CallReviewCard({ calls }: { calls: CallReview[] }) {
  return (
    <Card className="rise">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Call review</CardTitle>
        <CardDescription>Accountability ledger from the episode.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {calls.map((call) => (
            <div key={call.ticker} className="grid gap-2 bg-card p-3 sm:grid-cols-[90px_1fr_auto] sm:items-center">
              <div>
                <p className="text-sm font-semibold">{call.ticker}</p>
                <StatusBadge status={call.status} />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{call.note}</p>
              <div className="grid grid-cols-3 gap-2 text-right text-[10px] sm:w-44">
                <MiniLabel label="Entry" value={call.entry} />
                <MiniLabel label="Target" value={call.target} />
                <MiniLabel label="Stop" value={call.stop} />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalNoiseCard({ signal, noise }: { signal: string[]; noise: string[] }) {
  return (
    <Card className="rise rise-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Signal vs noise</CardTitle>
        <CardDescription>What the episode says to weight, and what to avoid over-reading.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <SignalList title="Signal" items={signal} icon={TrendingUp} tone="positive" />
        <SignalList title="Noise" items={noise} icon={TrendingDown} tone="negative" />
      </CardContent>
    </Card>
  );
}

function SignalList({ title, items, icon: Icon, tone: t }: { title: string; items: string[]; icon: typeof Activity; tone: "positive" | "negative" }) {
  return (
    <div className={cn("rounded-lg border p-3", t === "positive" ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50")}>
      <p className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold", t === "positive" ? "text-emerald-800" : "text-red-800")}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <div className="space-y-2">
        {items.map((item) => (
          <p key={item} className={cn("text-xs leading-relaxed", t === "positive" ? "text-emerald-950/80" : "text-red-950/80")}>{item}</p>
        ))}
      </div>
    </div>
  );
}

function DecisionTile({ icon: Icon, label, value, tone: t }: { icon: typeof Activity; label: string; value: number; tone: "positive" | "neutral" | "caution" }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-3", t === "positive" ? "border-emerald-200 bg-emerald-50/55" : t === "caution" ? "border-amber-200 bg-amber-50/55" : "border-border bg-muted/25")}>
      <Icon className={cn("h-4 w-4 shrink-0", t === "positive" ? "text-emerald-700" : t === "caution" ? "text-amber-700" : "text-muted-foreground")} />
      <div>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function ReasonList({ title, items, tone: t }: { title: string; items: string[]; tone: "positive" | "caution" | "neutral" }) {
  const styles = t === "positive"
    ? "border-emerald-200 bg-emerald-50/45 text-emerald-950/85"
    : t === "caution"
      ? "border-amber-200 bg-amber-50/55 text-amber-950/85"
      : "border-border bg-muted/25 text-foreground/80";
  return (
    <div className={cn("rounded-lg border p-3", styles)}>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="space-y-1.5">
        {items.map((item) => (
          <p key={item} className="text-xs leading-relaxed">{item}</p>
        ))}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict, label }: { verdict: PortfolioStrategyRow["verdict"]; label: string }) {
  if (verdict === "setup_add") return <Badge variant="green">{label}</Badge>;
  if (verdict === "add_candidate") return <Badge variant="blue">{label}</Badge>;
  if (verdict === "risk_review") return <Badge variant="amber">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

function setupStatusLabel(status: EnrichedTradeSetup["status"]): string {
  switch (status) {
    case "in_entry":
      return "In entry zone";
    case "below_entry":
      return "Below entry";
    case "above_entry":
      return "Above entry";
    case "extended":
      return "Already extended";
    case "invalidated":
      return "Invalidated";
    default:
      return "Watch";
  }
}

function DirectionBadge({ direction }: { direction: Direction }) {
  if (direction === "positive") return <Badge variant="green">Positive</Badge>;
  if (direction === "negative") return <Badge variant="red">Negative</Badge>;
  return <Badge variant="secondary">Neutral</Badge>;
}

function StatusBadge({ status }: { status: CallReview["status"] }) {
  if (status === "hit_target") return <Badge variant="green">Target hit</Badge>;
  if (status === "hit_stop") return <Badge variant="red">Stop hit</Badge>;
  return <Badge variant="blue">Open</Badge>;
}

function MiniLabel({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function qualityLabel(badge: EarningsQualityFlag["badge"]) {
  if (badge === "base_effect") return "Base effect";
  if (badge === "swing_positive") return "Loss to profit";
  return "Clean";
}

function bucketToneClass(bucket: SectorBucket) {
  switch (bucket) {
    case "energy":
      return "bg-amber-50 text-amber-700";
    case "cyclical":
      return "bg-blue-50 text-blue-700";
    case "defensive":
      return "bg-emerald-50 text-emerald-700";
    case "financials":
      return "bg-violet-50 text-violet-700";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// ── At a glance ─────────────────────────────────────────────────────────────

type GlanceItem = { icon: typeof Activity; label: string; text: string; tone: "positive" | "negative" | "neutral" | "caution" };

function AtAGlance({ data }: { data: Awaited<ReturnType<typeof getBullsBears>> }) {
  const items: GlanceItem[] = [];

  // 1. Regime / rotation — what's actually leading today
  if (data.regime) {
    const { label, leader, laggard } = data.regime;
    const leaderName = leader ? BUCKET_META[leader].label : null;
    const laggardName = laggard ? BUCKET_META[laggard].label : null;
    const t = leader === "defensive" ? "caution" : leader === "energy" || leader === "cyclical" ? "positive" : "neutral";
    items.push({
      icon: Gauge,
      label: "Market regime right now",
      text: laggardName
        ? `${label}. ${leaderName} stocks are leading today; ${laggardName} is lagging. Position in the direction of the rotation, not against it.`
        : `${label}. ${leaderName ?? "No clear leader"} is the leading bucket from today's PSX data.`,
      tone: t,
    });
  } else {
    items.push({
      icon: Gauge,
      label: "Market regime",
      text: `From the weekly brief: ${data.brief.regime.stance}. ${data.brief.regime.note.slice(0, 120)}…`,
      tone: "neutral",
    });
  }

  // 2. Score board — top pick right now
  const top = data.topPicks[0];
  if (top) {
    const ownedTop = data.topPicks.find((s) => data.ownedTickers.has(s.ticker));
    if (ownedTop) {
      items.push({
        icon: Briefcase,
        label: "Your highest-ranked holding",
        text: `${ownedTop.ticker} (${ownedTop.companyName ?? ownedTop.sector ?? ""}) ranks #${ownedTop.rank} out of ${data.scoredCount} companies with a score of ${ownedTop.score.toFixed(0)}/100. Its strongest sub-score is ${bestSubScore(ownedTop)}.`,
        tone: "positive",
      });
    } else {
      items.push({
        icon: BarChart3,
        label: "Top-ranked company right now",
        text: `${top.ticker} (${top.companyName ?? top.sector ?? ""}) is #1 out of ${data.scoredCount} ranked companies with a score of ${top.score.toFixed(0)}/100 — strongest on ${bestSubScore(top)}. Check it out in the score board below.`,
        tone: "positive",
      });
    }
  }

  // 3. Budget → portfolio (only if holdings are actually touched)
  const touched = data.budgetImpacts.filter((i) => i.holdings.length > 0);
  if (touched.length > 0) {
    const first = touched[0];
    const positive = first.item.direction === "positive";
    items.push({
      icon: Wallet,
      label: "Budget directly touches your portfolio",
      text: `"${first.item.policy}" hits ${first.holdings.join(", ")} in your holdings (${first.item.detail}). ${touched.length > 1 ? `${touched.length - 1} more policy item${touched.length > 2 ? "s" : ""} also matched.` : ""}`,
      tone: positive ? "positive" : "negative",
    });
  }

  // 4. Earnings quality — owned stock with a flag, or top watchlist caution
  const ownedFlag = data.earningsQuality.find((f) => data.ownedTickers.has(f.ticker));
  const watchlistCaution = data.brief.watchlist.find((w) => w.caution);
  if (ownedFlag) {
    items.push({
      icon: AlertTriangle,
      label: "Earnings quality caution — you own this",
      text: `${ownedFlag.ticker}: ${ownedFlag.caption}`,
      tone: "caution",
    });
  } else if (watchlistCaution) {
    items.push({
      icon: AlertTriangle,
      label: "Earnings quality caution from the episode",
      text: `${watchlistCaution.ticker}: ${watchlistCaution.caution}`,
      tone: "caution",
    });
  }

  // 5. #1 signal to watch from the brief
  const signal = data.brief.signalVsNoise.signal[0];
  if (signal) {
    items.push({
      icon: Target,
      label: "Key signal to watch",
      text: signal,
      tone: "neutral",
    });
  }

  // 6. Top noise warning
  const noise = data.brief.signalVsNoise.noise[0];
  if (noise) {
    items.push({
      icon: TrendingDown,
      label: "Don't over-read this",
      text: noise,
      tone: "negative",
    });
  }

  const toneStyles: Record<GlanceItem["tone"], string> = {
    positive: "border-emerald-200 bg-emerald-50/60",
    negative: "border-red-200 bg-red-50/60",
    caution: "border-amber-200 bg-amber-50/60",
    neutral: "border-border bg-muted/30",
  };
  const iconStyles: Record<GlanceItem["tone"], string> = {
    positive: "text-emerald-700",
    negative: "text-red-600",
    caution: "text-amber-700",
    neutral: "text-muted-foreground",
  };
  const labelStyles: Record<GlanceItem["tone"], string> = {
    positive: "text-emerald-800",
    negative: "text-red-800",
    caution: "text-amber-800",
    neutral: "text-muted-foreground",
  };
  const textStyles: Record<GlanceItem["tone"], string> = {
    positive: "text-emerald-950/85",
    negative: "text-red-950/85",
    caution: "text-amber-950/85",
    neutral: "text-foreground/80",
  };

  return (
    <Card className="rise rise-1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-emerald-600" /> This week at a glance</CardTitle>
        <CardDescription>
          Plain-English summary of what the live market data + this week&apos;s episode are telling you. Each point links to a section further down.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 md:grid-cols-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className={cn("flex gap-3 rounded-lg border p-3.5", toneStyles[item.tone])}>
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconStyles[item.tone])} />
                <div className="min-w-0">
                  <p className={cn("text-[10px] font-semibold uppercase tracking-wide", labelStyles[item.tone])}>{item.label}</p>
                  <p className={cn("mt-1 text-xs leading-relaxed", textStyles[item.tone])}>{item.text}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function bestSubScore(s: ScoredStock): string {
  const keys = Object.keys(s.subScores) as Array<keyof typeof s.subScores>;
  const best = keys.reduce((a, b) => ((s.subScores[a] ?? -1) >= (s.subScores[b] ?? -1) ? a : b));
  const labels: Record<string, string> = { growth: "Growth", quality: "Quality", value: "Value", momentum: "Momentum", income: "Income" };
  const val = s.subScores[best];
  return `${labels[best] ?? best}${val != null ? ` (${val.toFixed(0)}th percentile)` : ""}`;
}
