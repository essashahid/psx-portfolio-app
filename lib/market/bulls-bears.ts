import type { SupabaseClient } from "@supabase/supabase-js";
import { getScoreUniverse, type ScoredStock } from "@/lib/market/score";
import { bucketForSector, BUCKET_META, type SectorBucket } from "@/lib/market/sectors";
import { CURRENT_BRIEF, type WeeklyBrief, type PolicyItem } from "@/lib/market/weekly-brief";

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

export interface BullsBears {
  recap: RecapData | null;
  regime: RegimeRead | null;
  topPicks: ScoredStock[];
  bucketLeaders: Record<SectorBucket, ScoredStock[]>;
  scoredCount: number;
  marketCount: number;
  earningsQuality: EarningsQualityFlag[];
  budgetImpacts: BudgetImpact[];
  ownedTickers: Set<string>;
  brief: WeeklyBrief;
}

const TOP_PICKS = 50;
const BASE_EFFECT_EPS_GROWTH = 150; // % — extreme YoY EPS growth flags a likely base effect / one-off

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

export async function getBullsBears(supabase: SupabaseClient, userId: string): Promise<BullsBears> {
  const { data: snap } = await supabase
    .from("market_snapshots")
    .select("id, snapshot_date, snapshot_time, index_name, index_value, index_change_percent, total_advancers, total_decliners, total_unchanged, top_sector, bottom_sector, source_provider")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: holdings }, universe, regime] = await Promise.all([
    supabase.from("holdings").select("ticker, sector").eq("user_id", userId).gt("quantity", 0),
    getScoreUniverse(supabase),
    snap ? buildRegime(supabase, snap.id) : Promise.resolve(null),
  ]);

  const ownedTickers = new Set((holdings ?? []).map((h) => (h.ticker as string).toUpperCase()));
  const ownedSectors = new Set((holdings ?? []).map((h) => (h.sector as string | null)?.toLowerCase()).filter((x): x is string => !!x));

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

  // Budget → portfolio fan-out: which policy items touch the user's holdings.
  const budgetImpacts: BudgetImpact[] = CURRENT_BRIEF.budget.map((item) => {
    const hit = (holdings ?? [])
      .filter((h) => {
        const sec = (h.sector as string | null)?.toLowerCase() ?? "";
        const bucket = bucketForSector(h.sector as string | null);
        const keywordMatch = item.sectorKeywords.some((k) => sec.includes(k));
        const bucketMatch = item.buckets.includes(bucket) && item.sectorKeywords.length === 0;
        return keywordMatch || bucketMatch;
      })
      .map((h) => (h.ticker as string).toUpperCase());
    return { item, holdings: [...new Set(hit)] };
  });

  void ownedSectors; // reserved for future sector-level fan-out

  return {
    recap,
    regime,
    topPicks,
    bucketLeaders,
    scoredCount: universe.scoredCount,
    marketCount: universe.marketCount,
    earningsQuality,
    budgetImpacts,
    ownedTickers,
    brief: CURRENT_BRIEF,
  };
}
