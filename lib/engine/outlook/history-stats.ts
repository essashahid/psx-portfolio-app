/**
 * Descriptive statistics on PSX index history, for the Phase 1 evidence review.
 *
 * Everything here is BACKWARD-LOOKING and IN-SAMPLE. Nothing in this file
 * forecasts, and nothing here has been validated out of sample. Its only job is
 * to answer the question that decides whether a forecasting model is worth
 * building at all, and over which horizons: how often did each outcome actually
 * happen, and how many genuinely independent observations do we have to judge
 * that on?
 *
 * The independent-sample count is the number that matters. Overlapping windows
 * inflate an apparent sample enormously: 1,238 sessions yield ~1,175 overlapping
 * 3-month windows but only ~19 non-overlapping ones, and it is the latter that
 * bounds how confidently any 3-month claim can be made. Reporting only the
 * overlapping count would make a thin sample look rich.
 */

export interface ClosePoint {
  date: string;
  close: number;
}

/** Trading-session horizons under evaluation. Nothing is adopted yet. */
export const HORIZONS = [
  { key: "5d", sessions: 5, label: "5 sessions", family: "short" },
  { key: "10d", sessions: 10, label: "10 sessions", family: "short" },
  { key: "20d", sessions: 20, label: "20 sessions", family: "short" },
  { key: "1m", sessions: 21, label: "1 month (21 sessions)", family: "medium" },
  { key: "3m", sessions: 63, label: "3 months (63 sessions)", family: "medium" },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]["key"];

/** Drawdown thresholds tested at each horizon, as negative fractions. */
export const DRAWDOWN_THRESHOLDS = [-0.03, -0.05, -0.07, -0.1] as const;

/**
 * Rally thresholds, mirroring the drawdown ones. Measured the same way, as the
 * best point reached inside the window rather than where it closed, so the two
 * directions are directly comparable instead of one being a peak and the other
 * an endpoint.
 */
export const RALLY_THRESHOLDS = [0.03, 0.05, 0.07, 0.1] as const;

export interface ThresholdStat {
  /** Threshold as a negative fraction, e.g. -0.05 for a 5% decline. */
  threshold: number;
  /** Windows whose worst intra-window decline reached the threshold. */
  hits: number;
  /** Share of overlapping windows that hit, 0-1. */
  frequency: number;
}

export interface HorizonStat {
  key: HorizonKey;
  label: string;
  sessions: number;
  family: string;
  /** Overlapping forward windows available. Inflated; see file header. */
  overlappingWindows: number;
  /** Non-overlapping windows. This is the honest sample size. */
  independentWindows: number;
  /** Share of windows with a positive close-to-close return, 0-1. */
  positiveRate: number;
  /** Forward close-to-close return percentiles, as fractions. */
  returnPercentiles: { p10: number; p25: number; median: number; p75: number; p90: number };
  /** Worst intra-window decline from the entry close, as fractions. */
  drawdownPercentiles: { p10: number; median: number; worst: number };
  /** Best intra-window advance from the entry close, as fractions. */
  runupPercentiles: { p90: number; median: number; best: number };
  /** Frequency of reaching each drawdown threshold. */
  thresholds: ThresholdStat[];
  /** Frequency of reaching each rally threshold, the upside mirror. */
  rallyThresholds: ThresholdStat[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Forward outcomes from each entry point: the close-to-close return at the
 * horizon, and the worst and best points reached anywhere inside the window.
 *
 * The three answer different questions and a reader needs all of them. An index
 * can finish a month flat having fallen 8% midway and later recovered; the
 * holder lived through both the fall and the rally, and a close-to-close figure
 * alone hides each. Reporting only the drawdown, meanwhile, describes a market
 * that in this history rose more often than it fell.
 */
function forwardOutcomes(
  closes: number[],
  sessions: number
): { returns: number[]; drawdowns: number[]; runups: number[] } {
  const returns: number[] = [];
  const drawdowns: number[] = [];
  const runups: number[] = [];
  for (let i = 0; i + sessions < closes.length; i++) {
    const entry = closes[i];
    if (!(entry > 0)) continue;
    returns.push(closes[i + sessions] / entry - 1);
    let worst = 0;
    let best = 0;
    for (let j = i + 1; j <= i + sessions; j++) {
      const move = closes[j] / entry - 1;
      if (move < worst) worst = move;
      if (move > best) best = move;
    }
    drawdowns.push(worst);
    runups.push(best);
  }
  return { returns, drawdowns, runups };
}

/** Per-horizon descriptive statistics over the full supplied history. */
export function horizonStats(points: ClosePoint[]): HorizonStat[] {
  const closes = points.map((p) => p.close).filter((c) => Number.isFinite(c) && c > 0);
  return HORIZONS.map((h) => {
    const { returns, drawdowns, runups } = forwardOutcomes(closes, h.sessions);
    const sortedR = [...returns].sort((a, b) => a - b);
    const sortedD = [...drawdowns].sort((a, b) => a - b);
    const sortedU = [...runups].sort((a, b) => a - b);
    return {
      key: h.key,
      label: h.label,
      sessions: h.sessions,
      family: h.family,
      overlappingWindows: returns.length,
      independentWindows: Math.floor(closes.length / h.sessions),
      positiveRate: returns.length ? returns.filter((r) => r > 0).length / returns.length : NaN,
      returnPercentiles: {
        p10: percentile(sortedR, 0.1),
        p25: percentile(sortedR, 0.25),
        median: percentile(sortedR, 0.5),
        p75: percentile(sortedR, 0.75),
        p90: percentile(sortedR, 0.9),
      },
      drawdownPercentiles: {
        p10: percentile(sortedD, 0.1),
        median: percentile(sortedD, 0.5),
        worst: sortedD.length ? sortedD[0] : NaN,
      },
      runupPercentiles: {
        p90: percentile(sortedU, 0.9),
        median: percentile(sortedU, 0.5),
        best: sortedU.length ? sortedU[sortedU.length - 1] : NaN,
      },
      thresholds: DRAWDOWN_THRESHOLDS.map((threshold) => {
        const hits = drawdowns.filter((d) => d <= threshold).length;
        return { threshold, hits, frequency: drawdowns.length ? hits / drawdowns.length : NaN };
      }),
      rallyThresholds: RALLY_THRESHOLDS.map((threshold) => {
        const hits = runups.filter((u) => u >= threshold).length;
        return { threshold, hits, frequency: runups.length ? hits / runups.length : NaN };
      }),
    };
  });
}

// --- Volatility-clustering feasibility probe --------------------------------

export interface VolConditionalStat {
  horizonKey: HorizonKey;
  threshold: number;
  /** Base rate across all windows, 0-1. */
  baseRate: number;
  /** Drawdown frequency when trailing volatility is in its lowest third. */
  lowVolRate: number;
  /** Drawdown frequency when trailing volatility is in its highest third. */
  highVolRate: number;
  /** highVolRate / baseRate. Above 1 means trailing vol carried information. */
  lift: number;
  lowVolWindows: number;
  highVolWindows: number;
}

/** Annualised standard deviation of the trailing `window` daily log returns. */
function trailingVol(closes: number[], end: number, window: number): number | null {
  if (end - window < 0) return null;
  const rets: number[] = [];
  for (let i = end - window + 1; i <= end; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < window * 0.8) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}

/**
 * Does trailing realised volatility carry information about forward drawdown
 * risk? This is the single cheapest test of whether the early-warning idea has
 * any substance, because volatility clustering is the best-evidenced effect in
 * equity markets and is what a risk model would lean on.
 *
 * Strictly a feasibility probe, not a result: the tercile cut-offs are computed
 * over the whole sample, so this is in-sample and mildly optimistic. A strong
 * lift here justifies building and properly validating a model. A lift near 1
 * would say the effect is not present in this history and the feature should be
 * reconsidered before more is spent on it.
 */
export function volConditionalStats(
  points: ClosePoint[],
  volWindow = 21
): VolConditionalStat[] {
  const closes = points.map((p) => p.close).filter((c) => Number.isFinite(c) && c > 0);
  const out: VolConditionalStat[] = [];

  for (const h of HORIZONS) {
    const rows: { vol: number; worst: number }[] = [];
    for (let i = volWindow; i + h.sessions < closes.length; i++) {
      const vol = trailingVol(closes, i, volWindow);
      if (vol === null) continue;
      const entry = closes[i];
      let worst = 0;
      for (let j = i + 1; j <= i + h.sessions; j++) {
        const dd = closes[j] / entry - 1;
        if (dd < worst) worst = dd;
      }
      rows.push({ vol, worst });
    }
    if (rows.length < 30) continue;

    const sortedVol = rows.map((r) => r.vol).sort((a, b) => a - b);
    const loCut = percentile(sortedVol, 1 / 3);
    const hiCut = percentile(sortedVol, 2 / 3);
    const low = rows.filter((r) => r.vol <= loCut);
    const high = rows.filter((r) => r.vol >= hiCut);

    for (const threshold of DRAWDOWN_THRESHOLDS) {
      const rate = (set: { worst: number }[]) =>
        set.length ? set.filter((r) => r.worst <= threshold).length / set.length : NaN;
      const baseRate = rate(rows);
      const highVolRate = rate(high);
      out.push({
        horizonKey: h.key,
        threshold,
        baseRate,
        lowVolRate: rate(low),
        highVolRate,
        lift: baseRate > 0 ? highVolRate / baseRate : NaN,
        lowVolWindows: low.length,
        highVolWindows: high.length,
      });
    }
  }
  return out;
}

// --- Calendar coverage -----------------------------------------------------

export interface GapInfo {
  /** Weekday gaps longer than the tolerance, likely missing data or holidays. */
  gaps: { from: string; to: string; missingWeekdays: number }[];
  longestGapWeekdays: number;
  totalMissingWeekdays: number;
}

/** Weekdays strictly between two ISO dates, a rough proxy for expected sessions. */
function weekdaysBetween(from: string, to: string): number {
  let count = 0;
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d < end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

/**
 * Runs of consecutive missing weekdays in a daily series. PSX holidays produce
 * short legitimate gaps, so only runs beyond `toleranceWeekdays` are reported;
 * those are long enough to be a market closure worth knowing about or a real
 * hole in our data.
 */
export function findGaps(dates: string[], toleranceWeekdays = 3): GapInfo {
  const sorted = [...dates].sort();
  const gaps: GapInfo["gaps"] = [];
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const missing = weekdaysBetween(sorted[i - 1], sorted[i]);
    if (missing > 0) total += missing;
    if (missing > toleranceWeekdays) {
      gaps.push({ from: sorted[i - 1], to: sorted[i], missingWeekdays: missing });
    }
  }
  return {
    gaps: gaps.sort((a, b) => b.missingWeekdays - a.missingWeekdays).slice(0, 10),
    longestGapWeekdays: gaps.reduce((m, g) => Math.max(m, g.missingWeekdays), 0),
    totalMissingWeekdays: total,
  };
}
