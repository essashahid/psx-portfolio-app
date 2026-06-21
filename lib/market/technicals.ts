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

/**
 * Zigzag swing detection on close, used for the larger-trend pullback zone and
 * for momentum-divergence pivots. Threshold defaults high (8%) so we track the
 * major long-term swings, not short-term noise.
 */
export function findSwings(candles: Candle[], thresholdPct = 8): Swing[] {
  if (candles.length < 3) return [];
  const swings: Swing[] = [];
  const thr = thresholdPct / 100;
  let dir: "up" | "down" | null = null;
  let extremeIdx = 0;

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const extreme = candles[extremeIdx].close;
    if (dir === null) {
      const change = (price - candles[0].close) / candles[0].close;
      if (change >= thr) { dir = "up"; extremeIdx = i; }
      else if (change <= -thr) { dir = "down"; extremeIdx = i; }
      else if (price > extreme) extremeIdx = i;
      else if (price < candles[extremeIdx].close) extremeIdx = i;
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
  const swings = findSwings(clean, 8);
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
