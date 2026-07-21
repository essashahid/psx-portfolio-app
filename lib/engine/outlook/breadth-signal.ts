import { DRAWDOWN_THRESHOLDS, HORIZONS, trailingVol, type ClosePoint, type HorizonKey } from "@/lib/engine/outlook/history-stats";

/**
 * Does narrow market breadth precede declines?
 *
 * The volatility probe asks whether recent turbulence carries information. This
 * asks the same of participation: whether a market being carried by fewer and
 * fewer stocks has historically preceded falls. Both are descriptive and
 * in-sample, and neither is a forecast.
 *
 * The second question here matters more than the first. Narrow breadth and high
 * volatility tend to arrive together, so a breadth signal that merely restates
 * the volatility one adds nothing to a model. `quadrantStats` separates them by
 * asking whether narrowness still raises risk *within* the calm periods, where
 * volatility has nothing to say.
 */

export interface BreadthPoint {
  date: string;
  /** Share of symbols above their own 200-day average, 0-1. */
  pctAboveMa200: number | null;
}

export interface BreadthConditionalStat {
  horizonKey: HorizonKey;
  threshold: number;
  baseRate: number;
  /** Drawdown frequency after the narrowest third of readings. */
  narrowRate: number;
  /** Drawdown frequency after the broadest third. */
  broadRate: number;
  /** narrowRate / baseRate. Above 1 means narrowness carried information. */
  lift: number;
  narrowWindows: number;
  broadWindows: number;
}

export interface BreadthQuadrantStat {
  horizonKey: HorizonKey;
  threshold: number;
  /** Drawdown frequency in each combination of volatility and breadth state. */
  calmBroad: { rate: number; windows: number };
  calmNarrow: { rate: number; windows: number };
  turbulentBroad: { rate: number; windows: number };
  turbulentNarrow: { rate: number; windows: number };
  /**
   * calmNarrow / calmBroad. Isolates breadth from volatility: both groups are
   * calm, so anything above 1 is information volatility did not already carry.
   */
  narrowLiftWithinCalm: number;
  /**
   * Distinct market episodes behind the calm-and-narrow hits.
   *
   * The single most important number here. Overlapping windows drawn from one
   * bad fortnight produce dozens of apparent hits, so a lift computed from them
   * can rest on a single event. Counting runs of consecutive hit dates as one
   * episode gives the honest denominator.
   */
  calmNarrowEpisodes: number;
  calmNarrowHits: number;
  /** Whether enough distinct episodes stand behind this row to quote its lift. */
  quotable: boolean;
}

export interface BreadthSignalReport {
  /** Sessions where breadth and a forward window were both available. */
  usableSessions: number;
  firstDate: string | null;
  lastDate: string | null;
  conditional: BreadthConditionalStat[];
  quadrants: BreadthQuadrantStat[];
}

const VOL_WINDOW = 21;

/**
 * Distinct episodes required before a conditional rate is worth quoting.
 *
 * Set after measuring: several cells here show lifts near 5x that rest on a
 * single market episode seen through overlapping windows. A ratio built on one
 * event is a description of that event, not a pattern, and quoting it would be
 * the most misleading thing on the page.
 */
export const MIN_EPISODES_TO_QUOTE = 3;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const rateOf = (rows: { worst: number }[], threshold: number): number =>
  rows.length ? rows.filter((r) => r.worst <= threshold).length / rows.length : NaN;

/**
 * Collapse hit dates into distinct episodes.
 *
 * Consecutive trading days that each precede the same decline are one event
 * seen `sessions` times, not many events. Dates closer together than the
 * horizon are therefore treated as a single episode, which is the number a
 * reader should judge the evidence on.
 */
function countEpisodes(dates: string[], sessions: number): number {
  if (dates.length === 0) return 0;
  const sorted = [...dates].sort();
  let episodes = 1;
  let anchor = Date.parse(sorted[0]);
  // Calendar days spanned by the window, allowing for weekends and holidays.
  const spanMs = sessions * 1.6 * 86_400_000;
  for (const d of sorted.slice(1)) {
    const t = Date.parse(d);
    if (t - anchor > spanMs) {
      episodes++;
      anchor = t;
    }
  }
  return episodes;
}

interface Observation {
  date: string;
  breadth: number;
  vol: number;
  /** Worst decline reached inside the forward window, as a negative fraction. */
  worst: number;
}

/**
 * Align breadth readings to index closes and record what followed each.
 *
 * Both series are keyed by date rather than position because they are built
 * from different tables and a missing session in either would otherwise shift
 * every subsequent pairing by one day.
 */
function observationsFor(
  index: ClosePoint[],
  breadth: BreadthPoint[],
  sessions: number
): Observation[] {
  const closes = index.map((p) => p.close);
  const indexAt = new Map<string, number>();
  index.forEach((p, i) => indexAt.set(p.date, i));

  const out: Observation[] = [];
  for (const b of breadth) {
    if (b.pctAboveMa200 === null) continue;
    const i = indexAt.get(b.date);
    if (i === undefined || i + sessions >= closes.length) continue;
    const vol = trailingVol(closes, i, VOL_WINDOW);
    if (vol === null) continue;

    const entry = closes[i];
    if (!(entry > 0)) continue;
    let worst = 0;
    for (let j = i + 1; j <= i + sessions; j++) {
      const move = closes[j] / entry - 1;
      if (move < worst) worst = move;
    }
    out.push({ date: b.date, breadth: b.pctAboveMa200, vol, worst });
  }
  return out;
}

/**
 * Drawdown rates after narrow against broad participation.
 *
 * Note the direction is the opposite of the volatility probe: the risky state
 * is the *lowest* tercile, since narrow breadth is the warning sign, whereas
 * for volatility it is the highest.
 */
export function breadthConditionalStats(
  index: ClosePoint[],
  breadth: BreadthPoint[]
): BreadthConditionalStat[] {
  const out: BreadthConditionalStat[] = [];

  for (const h of HORIZONS) {
    const rows = observationsFor(index, breadth, h.sessions);
    if (rows.length < 60) continue;

    const sorted = rows.map((r) => r.breadth).sort((a, b) => a - b);
    const narrowCut = percentile(sorted, 1 / 3);
    const broadCut = percentile(sorted, 2 / 3);
    const narrow = rows.filter((r) => r.breadth <= narrowCut);
    const broad = rows.filter((r) => r.breadth >= broadCut);

    for (const threshold of DRAWDOWN_THRESHOLDS) {
      const baseRate = rateOf(rows, threshold);
      const narrowRate = rateOf(narrow, threshold);
      out.push({
        horizonKey: h.key,
        threshold,
        baseRate,
        narrowRate,
        broadRate: rateOf(broad, threshold),
        lift: baseRate > 0 ? narrowRate / baseRate : NaN,
        narrowWindows: narrow.length,
        broadWindows: broad.length,
      });
    }
  }
  return out;
}

/**
 * Breadth and volatility crossed, to test whether they are the same signal.
 *
 * If narrowness only looks informative because narrow markets are also
 * turbulent, then within the calm third it will carry no lift and the two are
 * redundant. If it still raises risk among calm periods, it is independent
 * information and worth a model's attention.
 */
export function breadthQuadrantStats(
  index: ClosePoint[],
  breadth: BreadthPoint[]
): BreadthQuadrantStat[] {
  const out: BreadthQuadrantStat[] = [];

  for (const h of HORIZONS) {
    const rows = observationsFor(index, breadth, h.sessions);
    if (rows.length < 90) continue;

    const bSorted = rows.map((r) => r.breadth).sort((a, b) => a - b);
    const vSorted = rows.map((r) => r.vol).sort((a, b) => a - b);
    const narrowCut = percentile(bSorted, 1 / 3);
    const broadCut = percentile(bSorted, 2 / 3);
    const calmCut = percentile(vSorted, 1 / 3);
    const turbulentCut = percentile(vSorted, 2 / 3);

    const calmBroad = rows.filter((r) => r.vol <= calmCut && r.breadth >= broadCut);
    const calmNarrow = rows.filter((r) => r.vol <= calmCut && r.breadth <= narrowCut);
    const turbBroad = rows.filter((r) => r.vol >= turbulentCut && r.breadth >= broadCut);
    const turbNarrow = rows.filter((r) => r.vol >= turbulentCut && r.breadth <= narrowCut);

    for (const threshold of DRAWDOWN_THRESHOLDS) {
      const cbRate = rateOf(calmBroad, threshold);
      const cnRate = rateOf(calmNarrow, threshold);
      const cnHitDates = calmNarrow.filter((r) => r.worst <= threshold).map((r) => r.date);
      const episodes = countEpisodes(cnHitDates, h.sessions);
      out.push({
        horizonKey: h.key,
        threshold,
        calmBroad: { rate: cbRate, windows: calmBroad.length },
        calmNarrow: { rate: cnRate, windows: calmNarrow.length },
        turbulentBroad: { rate: rateOf(turbBroad, threshold), windows: turbBroad.length },
        turbulentNarrow: { rate: rateOf(turbNarrow, threshold), windows: turbNarrow.length },
        narrowLiftWithinCalm: cbRate > 0 ? cnRate / cbRate : NaN,
        calmNarrowHits: cnHitDates.length,
        calmNarrowEpisodes: episodes,
        quotable: episodes >= MIN_EPISODES_TO_QUOTE,
      });
    }
  }
  return out;
}

/** Both probes plus the window they could actually be measured over. */
export function buildBreadthSignal(index: ClosePoint[], breadth: BreadthPoint[]): BreadthSignalReport {
  // The 200-day average needs 200 sessions of its own before it means anything,
  // so the usable window starts well after the price history does.
  const usable = breadth.filter((b) => b.pctAboveMa200 !== null).map((b) => b.date).sort();
  return {
    usableSessions: usable.length,
    firstDate: usable[0] ?? null,
    lastDate: usable[usable.length - 1] ?? null,
    conditional: breadthConditionalStats(index, breadth),
    quadrants: breadthQuadrantStats(index, breadth),
  };
}
