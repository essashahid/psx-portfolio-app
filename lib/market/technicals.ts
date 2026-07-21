/**
 * Long-term structure library. It applies the analytical lens of the "Bulls &
 * Bears" experts to long-term investing rather than trading.
 *
 * IMPORTANT. This platform is for long-term investors. This module deliberately
 * does NOT produce trading constructs (stop-losses, short-term price targets,
 * risk/reward, entry/exit "setups", Klinger/ABCD swing signals). It surfaces
 * only what helps a long-term investor decide WHETHER and ROUGHLY WHEN to
 * accumulate or trim a quality company:
 *   • the multi-year trend (weekly EMA21/55, Dow structure)
 *   • whether price sits in a healthy pullback / accumulation zone vs extended
 *   • trend-health warnings (momentum divergences) that flag thesis caution
 *   • multi-year seasonality, to time gradual capital deployment
 * The fundamentals (quality, value, growth, receivables, cash) remain the real
 * driver of the decision; this is supporting context, never a trade signal.
 *
 * Everything here is PURE. Data constraint: company_price_history stores daily
 * CLOSE + VOLUME only (no high/low), which is plenty for trend/accumulation
 * reads. The volatility helper is therefore close-based.
 */

export interface Candle {
  date: string; // ISO yyyy-mm-dd
  close: number;
  volume: number | null;
}

export interface Swing {
  index: number;
  date: string;
  price: number;
  kind: "high" | "low";
}

export interface Divergence {
  kind: "bullish" | "bearish";
  indicator: "RSI";
  from: { date: string; price: number; value: number };
  to: { date: string; price: number; value: number };
  note: string;
}

export interface EmaStructure {
  fast: number | null; // weekly EMA 21
  slow: number | null; // weekly EMA 55
  fastAboveSlow: boolean | null;
  priceAboveFast: boolean | null;
  note: string;
}

/**
 * Long-term accumulation read for a quality holding. NOT a trade plan: there is
 * no stop-loss, no profit target and no risk/reward. It answers "is the current
 * price a healthy long-term accumulation level, extended, or deteriorating?"
 */
export interface AccumulationView {
  zoneLow: number | null; // healthy pullback band of the larger up-leg (0.382–0.618 retrace)
  zoneHigh: number | null;
  majorSupport: number | null; // the larger-trend swing low
  status: "attractive" | "extended" | "deteriorating" | "unclear";
  distanceFromHighPct: number | null; // vs 52-week high
  note: string;
}

export interface SeasonalWindow {
  label: string;
  years: number;
  positive: number;
  winRatePct: number;
  avgReturnPct: number;
  bestPct: number;
  worstPct: number;
}

export interface TechnicalSignals {
  asOf: string | null;
  lastClose: number | null;
  longTermTrend: "uptrend" | "downtrend" | "range";
  emaWeekly: EmaStructure | null;
  rsi: number | null;
  divergences: Divergence[];
  accumulation: AccumulationView | null;
  seasonality: SeasonalWindow[];
}

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/** EMA series aligned to `values`; seeded with the SMA of the first window. */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function ema(values: number[], period: number): number | null {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

/** Simple moving-average series aligned to `values` (null until the window fills). */
export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

/** Wilder's RSI series, aligned to `values`. */
export function rsiSeries(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Timeframe + swing detection
// ---------------------------------------------------------------------------

/** Resample daily candles to weekly (last close of each ISO week, summed volume). */
export function toWeekly(candles: Candle[]): Candle[] {
  const byWeek = new Map<string, Candle>();
  for (const c of candles) {
    const d = new Date(c.date + "T00:00:00Z");
    const key = isoWeekKey(d);
    const existing = byWeek.get(key);
    if (!existing) byWeek.set(key, { date: c.date, close: c.close, volume: c.volume ?? 0 });
    else {
      existing.close = c.close;
      existing.date = c.date;
      existing.volume = (existing.volume ?? 0) + (c.volume ?? 0);
    }
  }
  return [...byWeek.values()];
}

function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Floor and ceiling for the auto-scaled swing threshold, in percent. */
const SWING_THRESHOLD_MIN_PCT = 8;
const SWING_THRESHOLD_MAX_PCT = 25;
/** Horizon, in trading days, over which a move should stand out to count as a swing. */
const SWING_HORIZON_DAYS = 10;

/**
 * Swing threshold scaled to the stock's own volatility.
 *
 * A fixed 8% threshold means very different things across the PSX. On a calm
 * large cap an 8% move is a genuine turning point; on a small cap running at
 * 77% annualized volatility it is an ordinary fortnight, which is why a flat
 * threshold produced 173 "swings" in five years for QTECH. Scaling by realized
 * volatility keeps the count comparable across the universe.
 */
export function swingThresholdFor(candles: Candle[]): number {
  const closes = candles.slice(-252).map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length < 30) return SWING_THRESHOLD_MIN_PCT;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const daily = Math.sqrt(variance);

  // 1.5 sigma over the swing horizon: big enough to ignore routine drift.
  const pct = 1.5 * daily * Math.sqrt(SWING_HORIZON_DAYS) * 100;
  if (!Number.isFinite(pct)) return SWING_THRESHOLD_MIN_PCT;
  return Math.min(SWING_THRESHOLD_MAX_PCT, Math.max(SWING_THRESHOLD_MIN_PCT, pct));
}

/**
 * Zigzag swing detection on close, used for the larger-trend pullback zone and
 * for momentum-divergence pivots. When `thresholdPct` is omitted the threshold
 * is scaled to the stock's realized volatility so we track major long-term
 * swings rather than noise.
 */
export function findSwings(candles: Candle[], thresholdPct?: number): Swing[] {
  if (candles.length < 3) return [];
  const swings: Swing[] = [];
  const thr = (thresholdPct ?? swingThresholdFor(candles)) / 100;
  let dir: "up" | "down" | null = null;
  let extremeIdx = 0;
  // Before a direction is established, track the running high and low
  // separately. Whichever breaks the threshold first sets the direction, and
  // the opposite extreme becomes the first pivot.
  let minIdx = 0;
  let maxIdx = 0;

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const extreme = candles[extremeIdx].close;
    if (dir === null) {
      if (price > candles[maxIdx].close) maxIdx = i;
      if (price < candles[minIdx].close) minIdx = i;
      const upFromMin = (price - candles[minIdx].close) / candles[minIdx].close;
      const downFromMax = (price - candles[maxIdx].close) / candles[maxIdx].close;
      if (upFromMin >= thr) {
        swings.push({ index: minIdx, date: candles[minIdx].date, price: candles[minIdx].close, kind: "low" });
        dir = "up";
        extremeIdx = i;
      } else if (downFromMax <= -thr) {
        swings.push({ index: maxIdx, date: candles[maxIdx].date, price: candles[maxIdx].close, kind: "high" });
        dir = "down";
        extremeIdx = i;
      }
      continue;
    }
    if (dir === "up") {
      if (price > extreme) extremeIdx = i;
      else if ((price - extreme) / extreme <= -thr) {
        swings.push({ index: extremeIdx, date: candles[extremeIdx].date, price: candles[extremeIdx].close, kind: "high" });
        dir = "down";
        extremeIdx = i;
      }
    } else {
      if (price < extreme) extremeIdx = i;
      else if ((price - extreme) / extreme >= thr) {
        swings.push({ index: extremeIdx, date: candles[extremeIdx].date, price: candles[extremeIdx].close, kind: "low" });
        dir = "up";
        extremeIdx = i;
      }
    }
  }
  swings.push({ index: extremeIdx, date: candles[extremeIdx].date, price: candles[extremeIdx].close, kind: dir === "up" ? "high" : "low" });
  return swings;
}

// ---------------------------------------------------------------------------
// Momentum divergence — a trend-health caution, not a trade trigger
// ---------------------------------------------------------------------------

export function detectDivergence(swings: Swing[], series: (number | null)[]): Divergence | null {
  const lows = swings.filter((s) => s.kind === "low").slice(-2);
  const highs = swings.filter((s) => s.kind === "high").slice(-2);

  if (lows.length === 2) {
    const [a, b] = lows;
    const va = series[a.index] ?? null;
    const vb = series[b.index] ?? null;
    if (va != null && vb != null && b.price < a.price && vb > va) {
      return {
        kind: "bullish",
        indicator: "RSI",
        from: { date: a.date, price: a.price, value: va },
        to: { date: b.date, price: b.price, value: vb },
        note: `Price fell to a lower low, from ${a.price.toFixed(2)} to ${b.price.toFixed(2)}, but momentum measured by RSI made a higher low. The long downtrend may be bottoming. For a quality company this can be a longer-term accumulation opportunity.`,
      };
    }
  }
  if (highs.length === 2) {
    const [a, b] = highs;
    const va = series[a.index] ?? null;
    const vb = series[b.index] ?? null;
    if (va != null && vb != null && b.price > a.price && vb < va) {
      return {
        kind: "bearish",
        indicator: "RSI",
        from: { date: a.date, price: a.price, value: va },
        to: { date: b.date, price: b.price, value: vb },
        note: `Price rose to a higher high, from ${a.price.toFixed(2)} to ${b.price.toFixed(2)}, but momentum measured by RSI made a lower high. Momentum is fading at the highs. This is not a sell signal for a long-term holder. It is a reason to be patient about adding here and to recheck the thesis.`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Accumulation view: is the current price a healthy long-term level?
// ---------------------------------------------------------------------------

export function buildAccumulationView(candles: Candle[], swings: Swing[], trend: TechnicalSignals["longTermTrend"]): AccumulationView | null {
  if (candles.length < 30) return null;
  const lastClose = candles[candles.length - 1].close;
  const yearCloses = candles.slice(-252).map((c) => c.close);
  const high52 = yearCloses.length ? Math.max(...yearCloses) : null;
  const distanceFromHighPct = high52 && high52 > 0 ? round(((lastClose - high52) / high52) * 100) : null;

  // Larger up-leg = last swing high and the swing low before it. The healthy
  // long-term pullback band is the 0.382–0.618 retracement of that leg.
  let highPos = -1;
  for (let i = swings.length - 1; i >= 0; i--) if (swings[i].kind === "high") { highPos = i; break; }
  let lowPos = -1;
  for (let i = highPos - 1; i >= 0; i--) if (swings[i].kind === "low") { lowPos = i; break; }

  if (highPos <= 0 || lowPos < 0) {
    return {
      zoneLow: null, zoneHigh: null, majorSupport: null, status: "unclear", distanceFromHighPct,
      note: "Not enough multi-year swing structure to define a long-term accumulation zone yet.",
    };
  }

  const swingHigh = swings[highPos].price;
  const swingLow = swings[lowPos].price;
  const span = swingHigh - swingLow;
  if (span <= 0) {
    return { zoneLow: null, zoneHigh: null, majorSupport: swingLow, status: "unclear", distanceFromHighPct, note: "The swing range is too small to define a clear accumulation band." };
  }

  const zoneLow = round(swingHigh - span * 0.618);
  const zoneHigh = round(swingHigh - span * 0.382);

  let status: AccumulationView["status"];
  let note: string;
  if (trend === "downtrend") {
    status = "deteriorating";
    note = `The long-term trend is down. Price is ${round(lastClose)}, which is ${distanceFromHighPct ?? "?"}% from the 52-week high. For a long-term investor this is only worth buying if the fundamental thesis is still intact and improving. Let valuation and quality lead, not the chart. Major support is near ${round(swingLow)}.`;
  } else if (lastClose < zoneLow) {
    status = "deteriorating";
    note = `Price ${round(lastClose)} has fallen below the normal pullback range of its larger up-leg, which sits between ${zoneLow} and ${zoneHigh}. Recheck the thesis. If the fundamentals still hold, this is a deeper-value accumulation area. If they are weakening, do not average down. Major support is near ${round(swingLow)}.`;
  } else if (lastClose <= zoneHigh) {
    status = "attractive";
    note = `Price ${round(lastClose)} sits in a healthy long-term pullback range, between ${zoneLow} and ${zoneHigh}, within an intact up-leg. This is a reasonable area to accumulate a quality company gradually. Major support is near ${round(swingLow)}.`;
  } else {
    status = "extended";
    note = `Price ${round(lastClose)} is above the healthy pullback range of ${zoneLow} to ${zoneHigh}, so it is extended versus its recent base. To add for the long term, accumulate gradually with a regular monthly plan rather than a lump sum, or wait for a pullback into that range.`;
  }

  return { zoneLow, zoneHigh, majorSupport: round(swingLow), status, distanceFromHighPct, note };
}

// ---------------------------------------------------------------------------
// Seasonality — for timing gradual capital deployment over months
// ---------------------------------------------------------------------------

export function seasonalWindow(
  candles: Candle[],
  start: { month: number; day: number },
  end: { month: number; day: number },
  label: string
): SeasonalWindow | null {
  if (candles.length < 30) return null;
  const byYear = new Map<number, Candle[]>();
  for (const c of candles) {
    const y = Number(c.date.slice(0, 4));
    (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(c);
  }
  const returns: number[] = [];
  for (const [, list] of byYear) {
    const startC = nearestOnOrAfter(list, start);
    const endC = nearestOnOrBefore(list, end);
    if (startC && endC && endC.date > startC.date && startC.close > 0) {
      returns.push(((endC.close - startC.close) / startC.close) * 100);
    }
  }
  if (returns.length < 3) return null;
  const positive = returns.filter((r) => r > 0).length;
  return {
    label,
    years: returns.length,
    positive,
    winRatePct: (positive / returns.length) * 100,
    avgReturnPct: returns.reduce((a, b) => a + b, 0) / returns.length,
    bestPct: Math.max(...returns),
    worstPct: Math.min(...returns),
  };
}

function dayOfYear(month: number, day: number): number {
  return month * 31 + day;
}
function nearestOnOrAfter(list: Candle[], target: { month: number; day: number }): Candle | null {
  const t = dayOfYear(target.month, target.day);
  for (const c of list) {
    if (dayOfYear(Number(c.date.slice(5, 7)), Number(c.date.slice(8, 10))) >= t) return c;
  }
  return null;
}
function nearestOnOrBefore(list: Candle[], target: { month: number; day: number }): Candle | null {
  const t = dayOfYear(target.month, target.day);
  let best: Candle | null = null;
  for (const c of list) {
    if (dayOfYear(Number(c.date.slice(5, 7)), Number(c.date.slice(8, 10))) <= t) best = c;
    else break;
  }
  return best;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Top-level: compute the long-term signal bundle from a close+volume series
// ---------------------------------------------------------------------------

export function computeSignals(candles: Candle[]): TechnicalSignals {
  const clean = candles
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const empty: TechnicalSignals = {
    asOf: clean.at(-1)?.date ?? null,
    lastClose: clean.at(-1)?.close ?? null,
    longTermTrend: "range",
    emaWeekly: null,
    rsi: null,
    divergences: [],
    accumulation: null,
    seasonality: [],
  };
  if (clean.length < 30) return empty;

  const closes = clean.map((c) => c.close);
  const lastClose = closes[closes.length - 1];

  // Weekly EMA 21/55 — the long-term trend filter.
  const weeklyCloses = toWeekly(clean).map((c) => c.close);
  const fast = ema(weeklyCloses, 21);
  const slow = ema(weeklyCloses, 55);
  const emaWeekly: EmaStructure = {
    fast, slow,
    fastAboveSlow: fast != null && slow != null ? fast > slow : null,
    priceAboveFast: fast != null ? lastClose > fast : null,
    note:
      fast != null && slow != null
        ? `The weekly EMA 21 is ${fast.toFixed(2)} and the EMA 55 is ${slow.toFixed(2)}. ${fast > slow ? "The faster average is above the slower one, so the multi-year trend is constructive." : "The faster average is below the slower one, so the multi-year trend is weak."} Price is ${lastClose > fast ? "above" : "below"} the EMA 21.`
        : "There is not enough weekly history to compute the EMA 21 and 55.",
  };

  let longTermTrend: TechnicalSignals["longTermTrend"] = "range";
  if (emaWeekly.fastAboveSlow && emaWeekly.priceAboveFast) longTermTrend = "uptrend";
  else if (emaWeekly.fastAboveSlow === false && emaWeekly.priceAboveFast === false) longTermTrend = "downtrend";

  const rsi = rsiSeries(closes, 14);
  const rsiVal = rsi[rsi.length - 1] ?? null;
  const swings = findSwings(clean);
  const divergences: Divergence[] = [];
  const rsiDiv = detectDivergence(swings, rsi);
  if (rsiDiv) divergences.push(rsiDiv);

  const accumulation = buildAccumulationView(clean, swings, longTermTrend);

  const seasonality: SeasonalWindow[] = [];
  const h2 = seasonalWindow(clean, { month: 6, day: 1 }, { month: 12, day: 31 }, "June to December");
  if (h2) seasonality.push(h2);
  const h1 = seasonalWindow(clean, { month: 1, day: 1 }, { month: 5, day: 31 }, "January to May");
  if (h1) seasonality.push(h1);

  return {
    asOf: clean[clean.length - 1].date,
    lastClose,
    longTermTrend,
    emaWeekly,
    rsi: rsiVal,
    divergences,
    accumulation,
    seasonality,
  };
}

// ---------------------------------------------------------------------------
// Support and Resistance Engine
// ---------------------------------------------------------------------------

export interface SupportResistanceZone {
  id: string;
  kind: "support" | "resistance";
  low: number;
  high: number;
  timeframe: "daily" | "weekly";
  confidence: "High" | "Medium" | "Low";
  touches: number;
  lastTested: string;
  method: string;
}

/** Bounds on the zone half-width, as a percentage of the level itself. */
const SR_TOLERANCE_MIN_PCT = 2;
const SR_TOLERANCE_MAX_PCT = 5;
/** A cluster may not span more than this multiple of its own tolerance. */
const SR_MAX_SPAN_MULTIPLE = 2.4;
/** Zones untested for longer than this (trading days back from the last bar) are dropped. */
const SR_MAX_AGE_DAYS = 504; // ~2 years
/** Zones further than this from the current price are not actionable. */
const SR_MAX_DISTANCE_PCT = 35;
/** Most zones we will ever return. */
const SR_MAX_ZONES = 8;

/**
 * Support and resistance zones, clustered from swing pivots.
 *
 * Three rules keep the output actionable rather than exhaustive:
 *
 *  - Tolerance is relative to each price level, not an absolute rupee amount
 *    derived from today's price. The previous absolute tolerance let a cluster
 *    drift as its mean moved, which is how QTECH ended up with a single "High
 *    confidence" zone spanning 0.85 to 4.33 while the stock traded at 50.
 *  - Zones are aged out and distance-filtered. A level last tested in 2023, or
 *    sitting 12x away from the current price, tells a long-term investor
 *    nothing about where to accumulate.
 *  - Kind is assigned by where the level sits relative to the current price,
 *    not by the kind of pivot that formed it. Broken resistance becomes
 *    support, which is how these levels actually behave.
 */
export function detectSupportResistanceZones(candles: Candle[], swings: Swing[], currentPrice: number): SupportResistanceZone[] {
  if (swings.length < 2 || !(currentPrice > 0) || candles.length === 0) return [];

  // Age is measured against the last bar we hold, not wall-clock time, so the
  // result is deterministic and still sensible on a stale cache.
  const cutoffIdx = Math.max(0, candles.length - 1 - SR_MAX_AGE_DAYS);
  const cutoffDate = candles[cutoffIdx].date;

  // A zone on a stock that routinely moves 20% has to be wider than one on a
  // stock that moves 5%, or nothing ever clusters and every level reads as a
  // one-off touch. Derive it from the same volatility the swing threshold uses.
  const tolerancePct = Math.min(
    SR_TOLERANCE_MAX_PCT,
    Math.max(SR_TOLERANCE_MIN_PCT, swingThresholdFor(candles) * 0.35)
  );

  // Cluster on price proximity alone. Highs and lows are deliberately mixed:
  // a level that capped a rally and later floored a selloff is the same level,
  // and merging them is what makes the touch count meaningful.
  const clusters: { prices: number[]; dates: string[] }[] = [];
  for (const s of swings) {
    if (!(s.price > 0) || s.date < cutoffDate) continue;
    let placed = false;
    for (const c of clusters) {
      const centre = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
      const within = Math.abs(s.price - centre) <= centre * (tolerancePct / 100);
      if (!within) continue;
      // Reject the merge if it would stretch the cluster past its max span.
      const lo = Math.min(s.price, ...c.prices);
      const hi = Math.max(s.price, ...c.prices);
      if ((hi - lo) / ((hi + lo) / 2) > (tolerancePct * SR_MAX_SPAN_MULTIPLE) / 100) continue;
      c.prices.push(s.price);
      c.dates.push(s.date);
      placed = true;
      break;
    }
    if (!placed) clusters.push({ prices: [s.price], dates: [s.date] });
  }

  const scored: (SupportResistanceZone & { score: number })[] = [];
  for (const c of clusters) {
    if (c.prices.length < 2) continue;

    const centre = c.prices.reduce((a, b) => a + b, 0) / c.prices.length;
    const distancePct = Math.abs((centre - currentPrice) / currentPrice) * 100;
    if (distancePct > SR_MAX_DISTANCE_PCT) continue;

    const pad = centre * (tolerancePct / 100) / 2;
    const lastTested = c.dates.slice().sort().at(-1)!;

    let confidence: "High" | "Medium" | "Low" = "Low";
    if (c.prices.length >= 4) confidence = "High";
    else if (c.prices.length === 3) confidence = "Medium";

    // Recency as a 0..1 weight over the age window.
    const testedIdx = candles.findIndex((b) => b.date >= lastTested);
    const barsAgo = testedIdx < 0 ? SR_MAX_AGE_DAYS : candles.length - 1 - testedIdx;
    const recency = Math.max(0, 1 - barsAgo / SR_MAX_AGE_DAYS);
    const nearness = Math.max(0, 1 - distancePct / SR_MAX_DISTANCE_PCT);

    scored.push({
      id: "",
      kind: centre < currentPrice ? "support" : "resistance",
      low: Math.min(...c.prices) - pad,
      high: Math.max(...c.prices) + pad,
      timeframe: "daily",
      confidence,
      touches: c.prices.length,
      lastTested,
      method: "Swing cluster detection",
      score: c.prices.length * (0.5 + recency) * (0.5 + nearness),
    });
  }

  const top = scored.sort((a, b) => b.score - a.score).slice(0, SR_MAX_ZONES);
  top.sort((a, b) => b.high - a.high); // present top-down, resistance first
  return top.map((z, i) => {
    const zone: SupportResistanceZone = {
      id: `sr_zone_${i + 1}`,
      kind: z.kind, low: z.low, high: z.high, timeframe: z.timeframe,
      confidence: z.confidence, touches: z.touches, lastTested: z.lastTested, method: z.method,
    };
    return zone;
  });
}

// ---------------------------------------------------------------------------
// OHLCV Conversion
// ---------------------------------------------------------------------------

export function toCanonicalOHLCV(ticker: string, candles: Candle[]): any {
  // Fallback CanonicalOHLCV when we only have close + volume
  // In Phase 1, we set open=high=low=close and status=unverified if not real OHLC
  return {
    symbol: ticker,
    exchange: "PSX",
    resolution: "1D",
    timezone: "Asia/Karachi",
    bars: candles.map(c => ({
      time: new Date(c.date + "T00:00:00Z").getTime(),
      open: c.close,
      high: c.close,
      low: c.close,
      close: c.close,
      volume: c.volume ?? 0,
      status: "unverified"
    })),
    latestMarketDate: candles.length > 0 ? candles[candles.length - 1].date : "",
    refreshedAt: new Date().toISOString(),
    adjustmentStatus: "unadjusted",
    dataQuality: "close-only"
  };
}

