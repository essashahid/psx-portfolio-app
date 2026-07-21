/**
 * Deterministic technical structure for the KSE-100.
 *
 * Every level and reading here comes from a documented rule over closes and
 * volumes. Nothing is fitted, nothing is asked of an LLM, and everything is
 * computable at any historical date from data at or before that date, so the
 * same code that draws today's levels is used to test whether the method has
 * been worth anything historically.
 *
 * Method notes, in one place:
 *  - Swing points are fractals: a close higher (lower) than the K closes on
 *    each side. Confirmation therefore arrives K sessions late, and the swing
 *    is only "known" from its confirmation date onward — the lookup respects
 *    that, or every historical test would see pivots before they existed.
 *  - Support/resistance are swing clusters: swings within a tolerance band are
 *    merged, weighted by touches and recency. The 52-week extremes and the two
 *    round thousands nearest the price join as candidate levels; nearly
 *    identical levels merge rather than being listed twice.
 *  - Expected movement is volatility arithmetic: an EWMA variance forecast
 *    scaled by the square root of the horizon. It says how far the market
 *    tends to travel, not which way.
 */

export interface Bar {
  date: string;
  close: number;
  volume: number | null;
}

export interface SwingPoint {
  date: string;
  index: number;
  price: number;
  kind: "high" | "low";
  /** Index at which the fractal became knowable (index + K). */
  confirmedAt: number;
}

export interface Level {
  price: number;
  kind: "support" | "resistance";
  /** How the level was derived. */
  source: "swing-cluster" | "52w-extreme" | "round-number";
  /** Swing touches inside the cluster (1 for non-cluster sources). */
  touches: number;
  /** Most recent date that contributed to the level. */
  lastTouch: string;
  /** Distance from the reference close, as a signed fraction. */
  distance: number;
}

export interface TechnicalStructure {
  asOf: string;
  close: number;
  /** Trend state against the two reference averages. */
  ma50: number | null;
  ma200: number | null;
  trend: "up" | "down" | "mixed" | "unknown";
  /** 14-session RSI, the standard overbought/oversold reading. */
  rsi14: number | null;
  momentum21: number | null;
  /** Donchian-style channel over the past 63 sessions. */
  channel: { high: number; low: number } | null;
  /** EWMA daily volatility (annualised) and the movement it implies. */
  ewmaVolAnnual: number | null;
  /** Expected absolute move over each horizon, as a fraction of the close. */
  expectedMove: { sessions: number; fraction: number }[];
  supports: Level[];
  resistances: Level[];
  /** Ratio of recent up-day volume to down-day volume, above 1 = accumulation. */
  volumeConfirmation: number | null;
  /** 52-week extremes. */
  high52w: number | null;
  low52w: number | null;
}

// --- Documented constants ----------------------------------------------------

/** Fractal wing: closes on each side a swing must dominate. */
export const SWING_K = 5;
/** Swings within this fraction of each other merge into one level. */
export const CLUSTER_TOLERANCE = 0.015;
/** Levels shown per side. More reads as noise, not information. */
export const LEVELS_PER_SIDE = 3;
/** EWMA decay for the variance forecast (RiskMetrics daily standard). */
export const EWMA_LAMBDA = 0.94;
/** Sessions of history a structure reading requires. */
export const MIN_HISTORY = 260;

const TRADING_DAYS = 252;

// --- Swings ------------------------------------------------------------------

/** All confirmed fractal swings in the series, oldest first. */
export function findSwings(bars: Bar[], k = SWING_K): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const c = bars[i].close;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].close >= c) isHigh = false;
      if (bars[j].close <= c) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ date: bars[i].date, index: i, price: c, kind: "high", confirmedAt: i + k });
    if (isLow) out.push({ date: bars[i].date, index: i, price: c, kind: "low", confirmedAt: i + k });
  }
  return out;
}

// --- Levels ------------------------------------------------------------------

interface Cluster {
  prices: number[];
  lastTouchIndex: number;
  lastTouchDate: string;
}

/**
 * Merge swing prices into clusters within the tolerance, then reduce each
 * cluster to a single level at its touch-weighted mean. Greedy in price order,
 * which is deterministic and adequate at this tolerance.
 */
function clusterSwings(swings: SwingPoint[]): Cluster[] {
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const clusters: Cluster[] = [];
  for (const s of sorted) {
    const last = clusters[clusters.length - 1];
    const anchor = last ? last.prices[0] : null;
    if (last && anchor !== null && (s.price - anchor) / anchor <= CLUSTER_TOLERANCE) {
      last.prices.push(s.price);
      if (s.index > last.lastTouchIndex) {
        last.lastTouchIndex = s.index;
        last.lastTouchDate = s.date;
      }
    } else {
      clusters.push({ prices: [s.price], lastTouchIndex: s.index, lastTouchDate: s.date });
    }
  }
  return clusters;
}

/** The two round thousands bracketing the close. Psychological levels only. */
function roundNumbersAround(close: number): number[] {
  const step = 1000;
  const below = Math.floor(close / step) * step;
  const above = below + step;
  return [below, above].filter((v) => v > 0);
}

/**
 * Support and resistance visible at `asOfIndex`, using only swings confirmed
 * by then. Cluster levels lead; the 52-week extremes and round numbers join
 * only when no cluster level already sits within the tolerance of them.
 */
export function levelsAt(bars: Bar[], asOfIndex: number): { supports: Level[]; resistances: Level[] } {
  const close = bars[asOfIndex].close;
  const visible = findSwings(bars.slice(0, asOfIndex + 1)).filter((s) => s.confirmedAt <= asOfIndex);
  const clusters = clusterSwings(visible);

  const candidates: Level[] = clusters.map((c) => {
    const price = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
    return {
      price,
      kind: price <= close ? "support" : "resistance",
      source: "swing-cluster" as const,
      touches: c.prices.length,
      lastTouch: c.lastTouchDate,
      distance: price / close - 1,
    };
  });

  const nearExisting = (price: number) => candidates.some((c) => Math.abs(c.price / price - 1) <= CLUSTER_TOLERANCE);

  const window = bars.slice(Math.max(0, asOfIndex + 1 - TRADING_DAYS), asOfIndex + 1);
  const high52 = Math.max(...window.map((b) => b.close));
  const low52 = Math.min(...window.map((b) => b.close));
  for (const [price, date] of [
    [high52, window.find((b) => b.close === high52)?.date ?? bars[asOfIndex].date],
    [low52, window.find((b) => b.close === low52)?.date ?? bars[asOfIndex].date],
  ] as [number, string][]) {
    if (!nearExisting(price)) {
      candidates.push({
        price,
        kind: price <= close ? "support" : "resistance",
        source: "52w-extreme",
        touches: 1,
        lastTouch: date,
        distance: price / close - 1,
      });
    }
  }

  for (const price of roundNumbersAround(close)) {
    if (!nearExisting(price)) {
      candidates.push({
        price,
        kind: price <= close ? "support" : "resistance",
        source: "round-number",
        touches: 1,
        lastTouch: bars[asOfIndex].date,
        distance: price / close - 1,
      });
    }
  }

  // Nearest first, ranked by proximity then touches; capped per side.
  const supports = candidates
    .filter((c) => c.kind === "support" && c.price < close)
    .sort((a, b) => b.price - a.price || b.touches - a.touches)
    .slice(0, LEVELS_PER_SIDE);
  const resistances = candidates
    .filter((c) => c.kind === "resistance" && c.price > close)
    .sort((a, b) => a.price - b.price || b.touches - a.touches)
    .slice(0, LEVELS_PER_SIDE);

  return { supports, resistances };
}

// --- Indicator arithmetic ----------------------------------------------------

function maAt(bars: Bar[], asOfIndex: number, window: number): number | null {
  if (asOfIndex + 1 < window) return null;
  let sum = 0;
  for (let i = asOfIndex + 1 - window; i <= asOfIndex; i++) sum += bars[i].close;
  return sum / window;
}

/** Wilder's RSI over `period` sessions. */
export function rsiAt(bars: Bar[], asOfIndex: number, period = 14): number | null {
  if (asOfIndex < period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = asOfIndex - period + 1; i <= asOfIndex; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gain += change;
    else loss -= change;
  }
  if (gain + loss === 0) return 50;
  const rs = loss === 0 ? Infinity : gain / loss;
  return 100 - 100 / (1 + rs);
}

/** EWMA daily volatility at the index, annualised. */
export function ewmaVolAt(bars: Bar[], asOfIndex: number, lambda = EWMA_LAMBDA): number | null {
  if (asOfIndex < 30) return null;
  let variance: number | null = null;
  for (let i = 1; i <= asOfIndex; i++) {
    const a = bars[i - 1].close;
    const b = bars[i].close;
    if (!(a > 0) || !(b > 0)) continue;
    const r = Math.log(b / a);
    variance = variance === null ? r * r : lambda * variance + (1 - lambda) * r * r;
  }
  return variance === null ? null : Math.sqrt(variance * TRADING_DAYS);
}

// --- The full structure ------------------------------------------------------

export function technicalStructureAt(bars: Bar[], asOfIndex: number, horizons = [5, 10, 20]): TechnicalStructure | null {
  if (asOfIndex + 1 < MIN_HISTORY) return null;
  const close = bars[asOfIndex].close;
  const ma50 = maAt(bars, asOfIndex, 50);
  const ma200 = maAt(bars, asOfIndex, 200);

  const trend: TechnicalStructure["trend"] =
    ma50 === null || ma200 === null
      ? "unknown"
      : close > ma50 && close > ma200
        ? "up"
        : close < ma50 && close < ma200
          ? "down"
          : "mixed";

  const channelWindow = bars.slice(asOfIndex + 1 - 63, asOfIndex + 1);
  const window52 = bars.slice(Math.max(0, asOfIndex + 1 - TRADING_DAYS), asOfIndex + 1);

  const ewma = ewmaVolAt(bars, asOfIndex);
  const expectedMove = horizons.map((sessions) => ({
    sessions,
    fraction: ewma === null ? NaN : (ewma / Math.sqrt(TRADING_DAYS)) * Math.sqrt(sessions),
  }));

  // Volume behind direction over the past 21 sessions.
  let upVol = 0;
  let downVol = 0;
  for (let i = Math.max(1, asOfIndex - 20); i <= asOfIndex; i++) {
    const v = bars[i].volume;
    if (v === null) continue;
    if (bars[i].close > bars[i - 1].close) upVol += v;
    else if (bars[i].close < bars[i - 1].close) downVol += v;
  }

  const mom = asOfIndex >= 21 ? close / bars[asOfIndex - 21].close - 1 : null;
  const { supports, resistances } = levelsAt(bars, asOfIndex);

  return {
    asOf: bars[asOfIndex].date,
    close,
    ma50,
    ma200,
    trend,
    rsi14: rsiAt(bars, asOfIndex),
    momentum21: mom,
    channel: channelWindow.length === 63 ? { high: Math.max(...channelWindow.map((b) => b.close)), low: Math.min(...channelWindow.map((b) => b.close)) } : null,
    ewmaVolAnnual: ewma,
    expectedMove,
    supports,
    resistances,
    volumeConfirmation: downVol > 0 ? upVol / downVol : null,
    high52w: window52.length ? Math.max(...window52.map((b) => b.close)) : null,
    low52w: window52.length ? Math.min(...window52.map((b) => b.close)) : null,
  };
}

// --- Level usefulness study --------------------------------------------------

export interface LevelStudy {
  /** Approaches: sessions where the close came within the band above a support. */
  approaches: number;
  /** Holds: approaches not followed by a close breaking the level by the margin within `horizon`. */
  holds: number;
  holdRate: number;
  /** The same measurement against placebo levels offset from real ones. */
  placeboApproaches: number;
  placeboHolds: number;
  placeboHoldRate: number;
  /** Real hold rate minus placebo hold rate. The whole question. */
  edge: number;
}

/**
 * Do swing-cluster supports actually hold more often than arbitrary nearby
 * prices? For every session, take the nearest support visible at that date;
 * if the close sits within `band` above it, that is an approach, and the level
 * held if no close breaks it by `margin` within `horizon` sessions. The same
 * count against placebo levels (each real level shifted by half the cluster
 * tolerance) says how much of the hold rate is the level and how much is just
 * markets not falling on any given fortnight.
 */
export function studySupportLevels(
  bars: Bar[],
  opts: { band?: number; margin?: number; horizon?: number; step?: number } = {}
): LevelStudy {
  const band = opts.band ?? 0.01;
  const margin = opts.margin ?? 0.01;
  const horizon = opts.horizon ?? 10;
  const step = opts.step ?? 1;

  let approaches = 0;
  let holds = 0;
  let placeboApproaches = 0;
  let placeboHolds = 0;

  const evaluate = (level: number, i: number): "approach-held" | "approach-broke" | "no-approach" => {
    const close = bars[i].close;
    const dist = close / level - 1;
    if (dist < 0 || dist > band) return "no-approach";
    for (let j = i + 1; j <= Math.min(i + horizon, bars.length - 1); j++) {
      if (bars[j].close < level * (1 - margin)) return "approach-broke";
    }
    return "approach-held";
  };

  for (let i = MIN_HISTORY; i < bars.length - horizon; i += step) {
    const { supports } = levelsAt(bars, i);
    const nearest = supports[0];
    if (!nearest) continue;

    const real = evaluate(nearest.price, i);
    if (real !== "no-approach") {
      approaches++;
      if (real === "approach-held") holds++;
    }

    const placebo = evaluate(nearest.price * (1 - CLUSTER_TOLERANCE / 2), i);
    if (placebo !== "no-approach") {
      placeboApproaches++;
      if (placebo === "approach-held") placeboHolds++;
    }
  }

  const holdRate = approaches ? holds / approaches : NaN;
  const placeboHoldRate = placeboApproaches ? placeboHolds / placeboApproaches : NaN;
  return {
    approaches,
    holds,
    holdRate,
    placeboApproaches,
    placeboHolds,
    placeboHoldRate,
    edge: Number.isFinite(holdRate) && Number.isFinite(placeboHoldRate) ? holdRate - placeboHoldRate : NaN,
  };
}
