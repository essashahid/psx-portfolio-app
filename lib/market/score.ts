import type { SupabaseClient } from "@supabase/supabase-js";
import { bucketForSector, type SectorBucket } from "@/lib/market/sectors";

/**
 * Composite "PSX Score" — the platform's equivalent of the show's Sarmaya
 * ranking. It blends signals the platform already computes into transparent
 * sub-scores and one headline score (0–100) plus a market rank, so 350 tickers
 * collapse into a ranked shortlist (the show's "top 50" demo).
 *
 * Everything is cross-sectional and rank-based: each metric is converted to a
 * percentile across the scored universe, so a single base-effect outlier can't
 * distort the scale and the numbers stay comparable across very different
 * sectors. No new tables — it reads cached company_ratios + company_technicals
 * joined to the latest market snapshot, and computes at request time.
 *
 * Sub-scores mirror the show's checklist:
 *   • Growth   — EPS / revenue / profit growth and multi-year CAGR
 *   • Quality  — ROE, ROIC, margins, cash conversion, interest cover, low leverage
 *   • Value    — earnings yield, FCF yield, book/sales/EV cheapness
 *   • Momentum — price vs MA50/200, distance from 52-week high
 *   • Income   — dividend yield + cover
 */

export type SubScoreKey = "growth" | "quality" | "value" | "momentum" | "income";

export const SUBSCORE_META: Record<SubScoreKey, { label: string; weight: number; blurb: string }> = {
  growth: { label: "Growth", weight: 0.3, blurb: "EPS, revenue & profit growth vs the prior period." },
  quality: { label: "Quality", weight: 0.25, blurb: "ROE, margins, interest cover and low leverage." },
  value: { label: "Value", weight: 0.15, blurb: "Earnings yield & dividend yield — how cheap." },
  momentum: { label: "Momentum", weight: 0.2, blurb: "Price vs 50/200-day MAs and distance from the 52-week high." },
  income: { label: "Income", weight: 0.1, blurb: "Dividend yield and dividend cover." },
};

export interface ScoredStock {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  bucket: SectorBucket;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  score: number; // 0–100 headline
  rank: number; // 1 = best
  subScores: Record<SubScoreKey, number | null>;
  // Headline raw inputs surfaced for the deep-dive / explainers.
  metrics: {
    epsGrowth: number | null;
    revenueGrowth: number | null;
    profitGrowth: number | null;
    roe: number | null;
    roic: number | null;
    netMargin: number | null;
    pe: number | null;
    pb: number | null;
    ps: number | null;
    evSales: number | null;
    evEbit: number | null;
    fcfYield: number | null;
    debtToEquity: number | null;
    netDebtToEquity: number | null;
    ocfToPat: number | null;
    accrualRatio: number | null;
    dividendYield: number | null;
    rsi: number | null;
    pctVsMa50: number | null;
    pctVsMa200: number | null;
    distFromHigh: number | null;
  };
}

export interface ScoreUniverse {
  stocks: ScoredStock[]; // sorted by score desc
  scoredCount: number;
  marketCount: number; // tickers in the snapshot (denominator for coverage)
  snapshotDate: string | null;
}

type RatioSubScoreKey = Exclude<SubScoreKey, "momentum">;

// Which raw ratio_name maps into each non-technical sub-score, and whether higher is better.
const RATIO_MAP: Record<RatioSubScoreKey, { name: string; higherBetter: boolean }[]> = {
  growth: [
    { name: "EPS growth", higherBetter: true },
    { name: "Revenue growth", higherBetter: true },
    { name: "Profit growth", higherBetter: true },
    { name: "EPS CAGR", higherBetter: true },
    { name: "Revenue CAGR", higherBetter: true },
  ],
  quality: [
    { name: "ROE", higherBetter: true },
    { name: "ROIC", higherBetter: true },
    { name: "Net margin", higherBetter: true },
    { name: "Gross margin", higherBetter: true },
    { name: "FCF margin", higherBetter: true },
    { name: "OCF / PAT", higherBetter: true },
    { name: "Cash conversion", higherBetter: true },
    { name: "Asset turnover", higherBetter: true },
    { name: "Interest coverage", higherBetter: true },
    { name: "Debt-to-equity", higherBetter: false },
    { name: "Net debt-to-equity", higherBetter: false },
    { name: "Debt / assets", higherBetter: false },
    { name: "Liabilities / assets", higherBetter: false },
    { name: "Accrual ratio", higherBetter: false },
  ],
  value: [
    { name: "Earnings yield", higherBetter: true },
    { name: "FCF yield", higherBetter: true },
    { name: "Dividend yield (TTM)", higherBetter: true },
    { name: "P/B", higherBetter: false },
    { name: "P/S", higherBetter: false },
    { name: "Price / FCF", higherBetter: false },
    { name: "EV/Sales", higherBetter: false },
    { name: "EV/EBIT", higherBetter: false },
  ],
  income: [
    { name: "Dividend yield (TTM)", higherBetter: true },
    { name: "Dividend cover", higherBetter: true },
  ],
};

const POSITIVE_ONLY_RATIOS = new Set(["P/E", "P/B", "P/S", "Price / FCF", "EV/Sales", "EV/EBIT"]);

interface Raw {
  ticker: string;
  ratios: Map<string, number>;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  rsi: number | null;
  pctVsMa50: number | null;
  pctVsMa200: number | null;
  distFromHigh: number | null;
}

/** Percentile (0–100) of `value` within `sorted` (ascending). Rank-based. */
function percentile(sorted: number[], value: number): number {
  if (sorted.length <= 1) return 50;
  // count of values strictly below + half of ties → smooth percentile
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal / 2) / sorted.length) * 100;
}

export async function getScoreUniverse(supabase: SupabaseClient): Promise<ScoreUniverse> {
  // Latest snapshot → market membership, sector, price, day move, mcap.
  const { data: snap } = await supabase
    .from("market_snapshots")
    .select("id, snapshot_date")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const itemByTicker = new Map<string, { companyName: string | null; sector: string | null; price: number | null; changePercent: number | null; marketCap: number | null }>();
  if (snap) {
    const { data: items } = await supabase
      .from("market_snapshot_items")
      .select("ticker, company_name, sector, price, change_percent, market_cap")
      .eq("snapshot_id", snap.id);
    for (const r of items ?? []) {
      itemByTicker.set((r.ticker as string).toUpperCase(), {
        companyName: r.company_name,
        sector: r.sector,
        price: r.price,
        changePercent: r.change_percent,
        marketCap: r.market_cap,
      });
    }
  }

  // All computed ratios (pivot per ticker).
  const ratiosByTicker = new Map<string, Map<string, number>>();
  {
    const { data: ratios } = await supabase
      .from("company_ratios")
      .select("ticker, ratio_name, ratio_value")
      .not("ratio_value", "is", null);
    for (const r of ratios ?? []) {
      const t = (r.ticker as string).toUpperCase();
      const name = r.ratio_name as string;
      const v = Number(r.ratio_value);
      if (!Number.isFinite(v)) continue;
      if (POSITIVE_ONLY_RATIOS.has(name) && v <= 0) continue;
      (ratiosByTicker.get(t) ?? ratiosByTicker.set(t, new Map()).get(t)!).set(name, v);
    }
  }

  // Technicals for momentum.
  const techByTicker = new Map<string, { rsi: number | null; ma50: number | null; ma200: number | null; price: number | null; high: number | null }>();
  {
    const tickers = [...ratiosByTicker.keys()];
    for (let i = 0; i < tickers.length; i += 500) {
      const { data: tech } = await supabase
        .from("company_technicals")
        .select("ticker, latest_price, moving_average_50, moving_average_200, rsi, fifty_two_week_high")
        .in("ticker", tickers.slice(i, i + 500));
      for (const r of tech ?? []) {
        techByTicker.set((r.ticker as string).toUpperCase(), {
          rsi: r.rsi != null ? Number(r.rsi) : null,
          ma50: r.moving_average_50 != null ? Number(r.moving_average_50) : null,
          ma200: r.moving_average_200 != null ? Number(r.moving_average_200) : null,
          price: r.latest_price != null ? Number(r.latest_price) : null,
          high: r.fifty_two_week_high != null ? Number(r.fifty_two_week_high) : null,
        });
      }
    }
  }

  // Assemble raw rows for every ticker that has ratios (the scorable set).
  const raws: Raw[] = [];
  for (const [ticker, ratios] of ratiosByTicker) {
    const item = itemByTicker.get(ticker);
    const tech = techByTicker.get(ticker);
    const price = tech?.price ?? item?.price ?? null;
    const pctVsMa50 = price != null && tech?.ma50 ? ((price - tech.ma50) / tech.ma50) * 100 : null;
    const pctVsMa200 = price != null && tech?.ma200 ? ((price - tech.ma200) / tech.ma200) * 100 : null;
    const distFromHigh = price != null && tech?.high ? ((price - tech.high) / tech.high) * 100 : null; // ≤ 0
    raws.push({
      ticker,
      ratios,
      companyName: item?.companyName ?? null,
      sector: item?.sector ?? null,
      price,
      changePercent: item?.changePercent ?? null,
      marketCap: item?.marketCap ?? null,
      rsi: tech?.rsi ?? null,
      pctVsMa50,
      pctVsMa200,
      distFromHigh,
    });
  }

  // Build sorted value arrays per ratio metric for percentile ranking.
  const sortedByMetric = new Map<string, number[]>();
  const collect = (name: string, get: (r: Raw) => number | null) => {
    const vals: number[] = [];
    for (const r of raws) {
      const v = get(r);
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    sortedByMetric.set(name, vals);
  };
  for (const group of Object.values(RATIO_MAP)) for (const m of group) collect(m.name, (r) => r.ratios.get(m.name) ?? null);
  // Momentum metrics (synthetic names).
  collect("@ma50", (r) => r.pctVsMa50);
  collect("@ma200", (r) => r.pctVsMa200);
  collect("@high", (r) => r.distFromHigh);

  const pctOf = (name: string, value: number | null, higherBetter: boolean): number | null => {
    if (value == null || !Number.isFinite(value)) return null;
    const sorted = sortedByMetric.get(name);
    if (!sorted || sorted.length < 3) return null; // too thin to rank meaningfully
    const p = percentile(sorted, value);
    return higherBetter ? p : 100 - p;
  };

  const mean = (xs: (number | null)[]): number | null => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };

  const scored: ScoredStock[] = raws.map((r) => {
    const sub: Record<SubScoreKey, number | null> = { growth: null, quality: null, value: null, momentum: null, income: null };
    for (const key of ["growth", "quality", "value", "income"] as RatioSubScoreKey[]) {
      sub[key] = mean(RATIO_MAP[key].map((m) => pctOf(m.name, r.ratios.get(m.name) ?? null, m.higherBetter)));
    }
    sub.momentum = mean([
      pctOf("@ma50", r.pctVsMa50, true),
      pctOf("@ma200", r.pctVsMa200, true),
      pctOf("@high", r.distFromHigh, true),
    ]);

    // Headline: weighted mean over available sub-scores, weights renormalized.
    let wsum = 0;
    let acc = 0;
    for (const key of Object.keys(SUBSCORE_META) as SubScoreKey[]) {
      const s = sub[key];
      if (s == null) continue;
      acc += s * SUBSCORE_META[key].weight;
      wsum += SUBSCORE_META[key].weight;
    }
    const score = wsum > 0 ? acc / wsum : 0;

    return {
      ticker: r.ticker,
      companyName: r.companyName,
      sector: r.sector,
      bucket: bucketForSector(r.sector),
      price: r.price,
      changePercent: r.changePercent,
      marketCap: r.marketCap,
      score: Math.round(score * 10) / 10,
      rank: 0,
      subScores: sub,
      metrics: {
        epsGrowth: r.ratios.get("EPS growth") ?? null,
        revenueGrowth: r.ratios.get("Revenue growth") ?? null,
        profitGrowth: r.ratios.get("Profit growth") ?? null,
        roe: r.ratios.get("ROE") ?? null,
        roic: r.ratios.get("ROIC") ?? null,
        netMargin: r.ratios.get("Net margin") ?? null,
        pe: r.ratios.get("P/E") ?? null,
        pb: r.ratios.get("P/B") ?? null,
        ps: r.ratios.get("P/S") ?? null,
        evSales: r.ratios.get("EV/Sales") ?? null,
        evEbit: r.ratios.get("EV/EBIT") ?? null,
        fcfYield: r.ratios.get("FCF yield") ?? null,
        debtToEquity: r.ratios.get("Debt-to-equity") ?? null,
        netDebtToEquity: r.ratios.get("Net debt-to-equity") ?? null,
        ocfToPat: r.ratios.get("OCF / PAT") ?? null,
        accrualRatio: r.ratios.get("Accrual ratio") ?? null,
        dividendYield: r.ratios.get("Dividend yield (TTM)") ?? null,
        rsi: r.rsi,
        pctVsMa50: r.pctVsMa50,
        pctVsMa200: r.pctVsMa200,
        distFromHigh: r.distFromHigh,
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  scored.forEach((s, i) => (s.rank = i + 1));

  return {
    stocks: scored,
    scoredCount: scored.length,
    marketCount: itemByTicker.size,
    snapshotDate: snap?.snapshot_date ?? null,
  };
}
