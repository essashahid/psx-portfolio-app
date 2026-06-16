import type { SupabaseClient } from "@supabase/supabase-js";
import { getScoreUniverse, type ScoredStock } from "@/lib/market/score";
import { bucketForSector, BUCKET_META, type SectorBucket } from "@/lib/market/sectors";
import { CURRENT_BRIEF, type WeeklyBrief, type PolicyItem, type TradeSetup } from "@/lib/market/weekly-brief";

/**
 * Bulls & Bears read model — assembles the show's repeatable pipeline from live
 * platform data plus the structured weekly brief:
 *   1. Market recap (index, breadth, leaders/laggards)
 *   2. Sector rotation → regime read (cyclical vs defensive leadership)
 *   3. Composite PSX-score ranking (the Sarmaya-score "top picks")
 *   4. Earnings-quality flags (base-effect / one-time skepticism)
 *   5. Budget → portfolio impact fan-out
 *   6. The weekly brief (macro, budget, call review, watchlist, signal/noise)
 *
 * One cached read per source; scoring is computed in memory. No new tables.
 */

export interface RecapData {
  indexName: string | null;
  indexValue: number | null;
  indexChangePct: number | null;
  advancers: number;
  decliners: number;
  unchanged: number;
  topSector: string | null;
  bottomSector: string | null;
  date: string | null;
  updatedLabel: string | null;
}

export interface BucketRow {
  bucket: SectorBucket;
  label: string;
  blurb: string;
  avgReturn: number | null;
  advancers: number;
  decliners: number;
  stockCount: number;
  topSector: string | null;
  topSectorReturn: number | null;
}

export interface RegimeRead {
  buckets: BucketRow[];
  leader: SectorBucket | null;
  laggard: SectorBucket | null;
  label: string; // e.g. "Cyclical-leading (risk-on)"
  note: string;
}

export interface EarningsQualityFlag {
  ticker: string;
  badge: "base_effect" | "swing_positive" | "clean";
  caption: string;
}

export interface BudgetImpact {
  item: PolicyItem;
  holdings: string[]; // user's owned tickers this fans out to
}

export interface EnrichedTradeSetup {
  setup: TradeSetup;
  stock: ScoredStock | null;
  owned: boolean;
  livePrice: number | null;
  entryMid: number | null;
  riskPct: number | null;
  rewardPct: number | null;
  status: "in_entry" | "below_entry" | "above_entry" | "extended" | "invalidated" | "watch";
  statusText: string;
}

export interface PortfolioStrategyRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  bucket: SectorBucket;
  quantity: number;
  avgCost: number | null;
  totalCost: number | null;
  livePrice: number | null;
  positionValue: number | null;
  unrealizedPct: number | null;
  score: number | null;
  rank: number | null;
  bestSubScore: string | null;
  weakestSubScore: string | null;
  matchedSetup: EnrichedTradeSetup | null;
  verdict: "setup_add" | "add_candidate" | "hold_watch" | "risk_review";
  verdictLabel: string;
  actionSentence: string;
  reasons: string[];
  risks: string[];
}

export interface BullsBears {
  recap: RecapData | null;
  regime: RegimeRead | null;
  topPicks: ScoredStock[];
  topOpportunities: ScoredStock[];
  bucketLeaders: Record<SectorBucket, ScoredStock[]>;
  scoredCount: number;
  marketCount: number;
  earningsQuality: EarningsQualityFlag[];
  budgetImpacts: BudgetImpact[];
  tradeSetups: EnrichedTradeSetup[];
  portfolioStrategy: PortfolioStrategyRow[];
  ownedTickers: Set<string>;
  brief: WeeklyBrief;
}

const TOP_PICKS = 50;
const BASE_EFFECT_EPS_GROWTH = 150; // % — extreme YoY EPS growth flags a likely base effect / one-off

interface HoldingRow {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  quantity: number | null;
  avg_cost: number | null;
  total_cost: number | null;
}

function classifyRegime(buckets: BucketRow[]): RegimeRead {
  const ranked = buckets.filter((b) => b.avgReturn != null && b.bucket !== "other").sort((a, b) => (b.avgReturn ?? 0) - (a.avgReturn ?? 0));
  const leader = ranked[0]?.bucket ?? null;
  const laggard = ranked[ranked.length - 1]?.bucket ?? null;
  const cyc = buckets.find((b) => b.bucket === "cyclical")?.avgReturn ?? null;
  const def = buckets.find((b) => b.bucket === "defensive")?.avgReturn ?? null;

  let label = "Mixed / no clear rotation";
  let note = "No decisive cyclical-vs-defensive leadership in today's tape.";
  if (cyc != null && def != null) {
    if (cyc - def > 0.3) {
      label = "Cyclical-leading (risk-on)";
      note = "Cyclicals are outpacing defensives — consistent with a risk-on tape. The show leans into strong-trend cyclicals here, with stops.";
    } else if (def - cyc > 0.3) {
      label = "Defensive-leading (risk-off)";
      note = "Defensives are outpacing cyclicals — a more defensive tape. Mirrors the show's cyclical → defensive rotation in a war/uncertainty regime.";
    } else {
      label = "Balanced rotation";
      note = "Cyclicals and defensives are moving together — pick by individual setup rather than the index.";
    }
  }
  const energy = buckets.find((b) => b.bucket === "energy")?.avgReturn ?? null;
  if (energy != null && leader === "energy") {
    note += " Energy is leading — the commodity-up → E&P/refinery/OMC profit chain is in play.";
  }
  return { buckets, leader, laggard, label, note };
}

async function buildRegime(supabase: SupabaseClient, snapshotId: string): Promise<RegimeRead | null> {
  const { data: sectors } = await supabase
    .from("sector_snapshots")
    .select("sector, average_return, advancers, decliners, stock_count")
    .eq("snapshot_id", snapshotId);
  if (!sectors || sectors.length === 0) return null;

  const agg = new Map<SectorBucket, { retSum: number; retCount: number; adv: number; dec: number; count: number; sectors: { name: string; ret: number | null }[] }>();
  for (const s of sectors) {
    const bucket = bucketForSector(s.sector as string);
    const a = agg.get(bucket) ?? { retSum: 0, retCount: 0, adv: 0, dec: 0, count: 0, sectors: [] };
    const ret = s.average_return != null ? Number(s.average_return) : null;
    if (ret != null) {
      a.retSum += ret * (s.stock_count ?? 1);
      a.retCount += s.stock_count ?? 1;
    }
    a.adv += s.advancers ?? 0;
    a.dec += s.decliners ?? 0;
    a.count += s.stock_count ?? 0;
    a.sectors.push({ name: s.sector as string, ret });
    agg.set(bucket, a);
  }

  const order: SectorBucket[] = ["energy", "cyclical", "defensive", "financials", "other"];
  const buckets: BucketRow[] = order
    .filter((b) => agg.has(b))
    .map((b) => {
      const a = agg.get(b)!;
      const top = [...a.sectors].filter((x) => x.ret != null).sort((x, y) => (y.ret ?? 0) - (x.ret ?? 0))[0] ?? null;
      return {
        bucket: b,
        label: BUCKET_META[b].label,
        blurb: BUCKET_META[b].blurb,
        avgReturn: a.retCount ? a.retSum / a.retCount : null,
        advancers: a.adv,
        decliners: a.dec,
        stockCount: a.count,
        topSector: top?.name ?? null,
        topSectorReturn: top?.ret ?? null,
      };
    });

  return classifyRegime(buckets);
}

/**
 * Earnings-quality pass for the shortlist. Rule-based skepticism over the
 * cached annual EPS series: an extreme YoY jump (or a loss→profit swing) is
 * flagged as a likely base-effect / one-time, mirroring the show's "is this
 * growth recurring?" check (the GGL bargain-purchase example).
 */
async function buildEarningsQuality(supabase: SupabaseClient, tickers: string[]): Promise<EarningsQualityFlag[]> {
  if (tickers.length === 0) return [];
  const { data: fin } = await supabase
    .from("company_financials")
    .select("ticker, fiscal_year, data")
    .in("ticker", tickers)
    .eq("statement_type", "income_statement")
    .eq("period_type", "annual");

  const epsByTicker = new Map<string, { year: number; eps: number }[]>();
  for (const r of fin ?? []) {
    const eps = (r.data as Record<string, unknown> | null)?.eps;
    const year = r.fiscal_year as number | null;
    if (typeof eps === "number" && Number.isFinite(eps) && year != null) {
      (epsByTicker.get(r.ticker as string) ?? epsByTicker.set(r.ticker as string, []).get(r.ticker as string)!).push({ year, eps });
    }
  }

  const flags: EarningsQualityFlag[] = [];
  for (const [ticker, series] of epsByTicker) {
    const sorted = series.sort((a, b) => b.year - a.year);
    if (sorted.length < 2) continue;
    const cur = sorted[0].eps;
    const prev = sorted[1].eps;
    if (prev <= 0 && cur > 0) {
      flags.push({ ticker, badge: "swing_positive", caption: `EPS swung from a loss (${prev.toFixed(2)}) to ${cur.toFixed(2)} — confirm it's operational, not a one-off.` });
    } else if (prev > 0) {
      const growth = ((cur - prev) / prev) * 100;
      if (growth >= BASE_EFFECT_EPS_GROWTH) {
        flags.push({ ticker, badge: "base_effect", caption: `EPS up ${growth.toFixed(0)}% YoY (${prev.toFixed(2)} → ${cur.toFixed(2)}) — check for one-time gains / base effect before treating as recurring.` });
      }
    }
  }
  return flags;
}

function subScoreLabel(key: string): string {
  const labels: Record<string, string> = {
    growth: "growth",
    quality: "quality",
    value: "value",
    momentum: "momentum",
    income: "income",
  };
  return labels[key] ?? key;
}

function bestSubScore(stock: ScoredStock): string | null {
  const entries = Object.entries(stock.subScores).filter((entry): entry is [string, number] => entry[1] != null);
  if (!entries.length) return null;
  const [key, value] = entries.sort((a, b) => b[1] - a[1])[0];
  return `${subScoreLabel(key)} (${value.toFixed(0)})`;
}

function weakestSubScore(stock: ScoredStock): string | null {
  const entries = Object.entries(stock.subScores).filter((entry): entry is [string, number] => entry[1] != null);
  if (!entries.length) return null;
  const [key, value] = entries.sort((a, b) => a[1] - b[1])[0];
  return `${subScoreLabel(key)} (${value.toFixed(0)})`;
}

function setupMid(setup: TradeSetup): number | null {
  if (setup.entryLow != null && setup.entryHigh != null) return (setup.entryLow + setup.entryHigh) / 2;
  return setup.entryLow ?? setup.entryHigh ?? null;
}

function enrichTradeSetup(setup: TradeSetup, stock: ScoredStock | null, owned: boolean): EnrichedTradeSetup {
  const livePrice = stock?.price ?? null;
  const entryMid = setupMid(setup);
  const stop = setup.stopPrice;
  const firstTarget = setup.targets.find((t) => t.price != null)?.price ?? null;
  const finalTarget = [...setup.targets].reverse().find((t) => t.price != null)?.price ?? null;
  const riskPct = entryMid != null && stop != null ? ((entryMid - stop) / entryMid) * 100 : null;
  const rewardPct = entryMid != null && firstTarget != null ? ((firstTarget - entryMid) / entryMid) * 100 : null;

  let status: EnrichedTradeSetup["status"] = "watch";
  let statusText = "Track the setup and wait for the defined price zone.";
  if (livePrice != null && setup.stopPrice != null && livePrice <= setup.stopPrice) {
    status = "invalidated";
    statusText = `Live price is at/below the stop (${setup.stop}); the original setup is invalid until rebuilt.`;
  } else if (livePrice != null && setup.entryLow != null && setup.entryHigh != null && livePrice >= setup.entryLow && livePrice <= setup.entryHigh) {
    status = "in_entry";
    statusText = `Live price is inside the episode entry zone (${setup.entry}).`;
  } else if (livePrice != null && setup.entryLow != null && livePrice < setup.entryLow) {
    status = "below_entry";
    statusText = `Live price is below the planned entry zone; wait for a fresh reversal, not a blind catch.`;
  } else if (livePrice != null && finalTarget != null && livePrice >= finalTarget) {
    status = "extended";
    statusText = `Live price has already reached/passed the far target; chasing would need a new setup.`;
  } else if (livePrice != null && setup.entryHigh != null && livePrice > setup.entryHigh) {
    status = "above_entry";
    statusText = `Live price is above the entry zone. Risk/reward is weaker unless it retests or forms a new base.`;
  }

  return { setup, stock, owned, livePrice, entryMid, riskPct, rewardPct, status, statusText };
}

function buildPortfolioStrategy({
  holdings,
  stockByTicker,
  setupByTicker,
  qualityByTicker,
  budgetImpacts,
  regime,
}: {
  holdings: HoldingRow[];
  stockByTicker: Map<string, ScoredStock>;
  setupByTicker: Map<string, EnrichedTradeSetup>;
  qualityByTicker: Map<string, EarningsQualityFlag>;
  budgetImpacts: BudgetImpact[];
  regime: RegimeRead | null;
}): PortfolioStrategyRow[] {
  const positiveBudget = new Map<string, string[]>();
  const negativeBudget = new Map<string, string[]>();
  for (const impact of budgetImpacts) {
    for (const ticker of impact.holdings) {
      const map = impact.item.direction === "negative" ? negativeBudget : impact.item.direction === "positive" ? positiveBudget : null;
      if (map) (map.get(ticker) ?? map.set(ticker, []).get(ticker)!).push(impact.item.policy);
    }
  }

  return holdings.map((h) => {
    const ticker = h.ticker.toUpperCase();
    const stock = stockByTicker.get(ticker) ?? null;
    const bucket = stock?.bucket ?? bucketForSector(h.sector);
    const setup = setupByTicker.get(ticker) ?? null;
    const qualityFlag = qualityByTicker.get(ticker) ?? null;
    const livePrice = stock?.price ?? null;
    const quantity = Number(h.quantity ?? 0);
    const avgCost = h.avg_cost != null ? Number(h.avg_cost) : null;
    const totalCost = h.total_cost != null ? Number(h.total_cost) : avgCost != null ? avgCost * quantity : null;
    const positionValue = livePrice != null ? livePrice * quantity : totalCost;
    const unrealizedPct = livePrice != null && avgCost && avgCost > 0 ? ((livePrice - avgCost) / avgCost) * 100 : null;

    const reasons: string[] = [];
    const risks: string[] = [];
    const score = stock?.score ?? null;
    const rank = stock?.rank ?? null;
    const alignedWithRegime = regime?.leader === bucket || CURRENT_BRIEF.regime.favored.includes(bucket);
    const posBudget = positiveBudget.get(ticker) ?? [];
    const negBudget = negativeBudget.get(ticker) ?? [];

    if (setup) reasons.push(`The episode has a defined ${setup.setup.setupLabel} with entry ${setup.setup.entry}, stop ${setup.setup.stop}, and targets ${setup.setup.targets.map((t) => t.label + (t.price ? ` ${t.price}` : "")).join(" / ")}.`);
    if (score != null && score >= 70) reasons.push(`Composite score is strong at ${score.toFixed(0)}/100, rank #${rank}.`);
    else if (score != null && score >= 55) reasons.push(`Composite score is acceptable at ${score.toFixed(0)}/100, rank #${rank}.`);
    if (stock?.subScores.momentum != null && stock.subScores.momentum >= 60) reasons.push(`Momentum is supportive (${stock.subScores.momentum.toFixed(0)} percentile).`);
    if (stock?.subScores.quality != null && stock.subScores.quality >= 60) reasons.push(`Quality screen is supportive (${stock.subScores.quality.toFixed(0)} percentile).`);
    if (alignedWithRegime) reasons.push(`${BUCKET_META[bucket].label} matches the episode/live rotation focus.`);
    if (posBudget.length) reasons.push(`Budget tailwind matched: ${posBudget.join(", ")}.`);

    if (qualityFlag) risks.push(qualityFlag.caption);
    if (score != null && score < 45) risks.push(`Composite score is weak at ${score.toFixed(0)}/100; do not add without a fresh catalyst.`);
    if (stock?.subScores.momentum != null && stock.subScores.momentum < 40) risks.push(`Momentum is weak (${stock.subScores.momentum.toFixed(0)} percentile).`);
    if (stock?.subScores.quality != null && stock.subScores.quality < 40) risks.push(`Quality score is weak (${stock.subScores.quality.toFixed(0)} percentile).`);
    if (negBudget.length) risks.push(`Budget headwind matched: ${negBudget.join(", ")}.`);
    if (setup?.status === "extended") risks.push("The episode setup has already stretched into/past target territory.");
    if (setup?.status === "invalidated") risks.push("The episode setup is invalidated by price trading through the stop.");

    let verdict: PortfolioStrategyRow["verdict"] = "hold_watch";
    let verdictLabel = "Hold / watch";
    if (setup && (setup.status === "in_entry" || setup.status === "below_entry") && (score == null || score >= 55) && !qualityFlag) {
      verdict = "setup_add";
      verdictLabel = "Episode setup";
    } else if (score != null && score >= 70 && alignedWithRegime && !qualityFlag) {
      verdict = "add_candidate";
      verdictLabel = "Add candidate";
    } else if ((score != null && score < 45) || qualityFlag || negBudget.length > 0 || setup?.status === "invalidated") {
      verdict = "risk_review";
      verdictLabel = "Review risk";
    }

    const actionSentence =
      verdict === "setup_add"
        ? `${ticker} is the clearest show-style add candidate you already own: only use the defined entry/stop, not a market chase.`
        : verdict === "add_candidate"
          ? `${ticker} screens well and fits the rotation; review whether your position size should be increased on a pullback.`
          : verdict === "risk_review"
            ? `${ticker} needs a risk review before adding more because the score, quality, budget, or setup state is not clean.`
            : `${ticker} is a hold/watch: keep it on the board, but wait for either a cleaner setup or stronger score confirmation before adding.`;

    return {
      ticker,
      companyName: stock?.companyName ?? h.company_name ?? null,
      sector: stock?.sector ?? h.sector ?? null,
      bucket,
      quantity,
      avgCost,
      totalCost,
      livePrice,
      positionValue,
      unrealizedPct,
      score,
      rank,
      bestSubScore: stock ? bestSubScore(stock) : null,
      weakestSubScore: stock ? weakestSubScore(stock) : null,
      matchedSetup: setup,
      verdict,
      verdictLabel,
      actionSentence,
      reasons: reasons.length ? reasons : ["No strong score/setup signal yet. Keep it on watch until the data improves."],
      risks,
    };
  }).sort((a, b) => {
    const order = { setup_add: 0, add_candidate: 1, risk_review: 2, hold_watch: 3 };
    return order[a.verdict] - order[b.verdict] || (b.score ?? -1) - (a.score ?? -1);
  });
}

export async function getBullsBears(supabase: SupabaseClient, userId: string): Promise<BullsBears> {
  const { data: snap } = await supabase
    .from("market_snapshots")
    .select("id, snapshot_date, snapshot_time, index_name, index_value, index_change_percent, total_advancers, total_decliners, total_unchanged, top_sector, bottom_sector, source_provider")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: holdings }, universe, regime] = await Promise.all([
    supabase.from("holdings").select("ticker, company_name, sector, quantity, avg_cost, total_cost").eq("user_id", userId).gt("quantity", 0),
    getScoreUniverse(supabase),
    snap ? buildRegime(supabase, snap.id) : Promise.resolve(null),
  ]);

  const holdingRows = (holdings ?? []) as HoldingRow[];
  const ownedTickers = new Set(holdingRows.map((h) => h.ticker.toUpperCase()));
  const stockByTicker = new Map(universe.stocks.map((s) => [s.ticker, s]));

  const recap: RecapData | null = snap
    ? {
        indexName: snap.index_name,
        indexValue: snap.index_value,
        indexChangePct: snap.index_change_percent,
        advancers: snap.total_advancers,
        decliners: snap.total_decliners,
        unchanged: snap.total_unchanged,
        topSector: snap.top_sector,
        bottomSector: snap.bottom_sector,
        date: snap.snapshot_date,
        updatedLabel: snap.snapshot_time
          ? new Date(snap.snapshot_time).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" })
          : null,
      }
    : null;

  const topPicks = universe.stocks.slice(0, TOP_PICKS);

  // Best-scored name per regime bucket (the show's "best in cement / energy").
  const bucketLeaders = { energy: [], cyclical: [], defensive: [], financials: [], other: [] } as Record<SectorBucket, ScoredStock[]>;
  for (const s of universe.stocks) {
    if (bucketLeaders[s.bucket].length < 5) bucketLeaders[s.bucket].push(s);
  }

  const earningsQuality = await buildEarningsQuality(supabase, topPicks.map((p) => p.ticker));
  const qualityByTicker = new Map(earningsQuality.map((f) => [f.ticker.toUpperCase(), f]));

  // Budget → portfolio fan-out: which policy items touch the user's holdings.
  const budgetImpacts: BudgetImpact[] = CURRENT_BRIEF.budget.map((item) => {
    const hit = holdingRows
      .filter((h) => {
        const sec = h.sector?.toLowerCase() ?? "";
        const bucket = bucketForSector(h.sector);
        const keywordMatch = item.sectorKeywords.some((k) => sec.includes(k));
        const bucketMatch = item.buckets.includes(bucket) && item.sectorKeywords.length === 0;
        return keywordMatch || bucketMatch;
      })
      .map((h) => h.ticker.toUpperCase());
    return { item, holdings: [...new Set(hit)] };
  });

  const tradeSetups = CURRENT_BRIEF.tradeSetups.map((setup) =>
    enrichTradeSetup(setup, stockByTicker.get(setup.ticker.toUpperCase()) ?? null, ownedTickers.has(setup.ticker.toUpperCase()))
  );
  const setupByTicker = new Map(tradeSetups.map((s) => [s.setup.ticker.toUpperCase(), s]));

  const portfolioStrategy = buildPortfolioStrategy({
    holdings: holdingRows,
    stockByTicker,
    setupByTicker,
    qualityByTicker,
    budgetImpacts,
    regime,
  });

  const preferredBuckets = new Set<SectorBucket>([...(regime?.leader ? [regime.leader] : []), ...CURRENT_BRIEF.regime.favored]);
  const flaggedTickers = new Set(earningsQuality.map((f) => f.ticker.toUpperCase()));
  const topOpportunities = universe.stocks
    .filter((s) => !ownedTickers.has(s.ticker))
    .filter((s) => s.score >= 60)
    .filter((s) => preferredBuckets.size === 0 || preferredBuckets.has(s.bucket) || s.rank <= 15)
    .filter((s) => !flaggedTickers.has(s.ticker))
    .slice(0, 12);

  return {
    recap,
    regime,
    topPicks,
    topOpportunities,
    bucketLeaders,
    scoredCount: universe.scoredCount,
    marketCount: universe.marketCount,
    earningsQuality,
    budgetImpacts,
    tradeSetups,
    portfolioStrategy,
    ownedTickers,
    brief: CURRENT_BRIEF,
  };
}
