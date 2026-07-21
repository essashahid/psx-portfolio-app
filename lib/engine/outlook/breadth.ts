/**
 * Market breadth reconstructed from constituent EOD prices.
 *
 * PSX publishes no historical advance/decline endpoint, which made breadth look
 * unobtainable for any day before the platform started capturing it. But
 * breadth is not a separate dataset: it is a count over constituent prices, and
 * those are available per symbol for the portal's full five-year window. So the
 * whole history is recoverable by counting.
 *
 * Pure functions over an already-loaded price panel. Loading and persistence
 * live in the backfill script, so the arithmetic here stays testable.
 */

export interface PricePoint {
  date: string;
  close: number;
  volume: number | null;
}

/** One symbol's history, oldest first. */
export type PricePanel = Map<string, PricePoint[]>;

export interface BreadthDay {
  trade_date: string;
  counted: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  advance_share: number | null;
  pct_above_ma50: number | null;
  pct_above_ma200: number | null;
  new_highs_52w: number | null;
  new_lows_52w: number | null;
  median_return: number | null;
  return_dispersion: number | null;
  up_volume: number | null;
  down_volume: number | null;
}

const MA_SHORT = 50;
const MA_LONG = 200;
const WEEKS_52 = 252;

/**
 * A symbol only counts on a day where it has a close and a previous close.
 * Requiring both means a newly listed or newly resumed symbol does not register
 * as a decline on its first appearance simply because it had nothing to compare
 * against.
 */
interface SymbolCursor {
  points: PricePoint[];
  /** Index of each date within `points`, so a day lookup is not a scan. */
  indexByDate: Map<string, number>;
}

function buildCursors(panel: PricePanel): Map<string, SymbolCursor> {
  const cursors = new Map<string, SymbolCursor>();
  for (const [ticker, points] of panel) {
    if (points.length < 2) continue;
    const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
    const indexByDate = new Map<string, number>();
    sorted.forEach((p, i) => indexByDate.set(p.date, i));
    cursors.set(ticker, { points: sorted, indexByDate });
  }
  return cursors;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

/**
 * Breadth for every date in `dates`, computed from the panel.
 *
 * Ratios are returned as fractions in 0-1 rather than percentages, matching how
 * every other rate in the outlook engine is carried, so nothing has to remember
 * which scale it is on.
 */
export function computeBreadth(panel: PricePanel, dates: string[]): BreadthDay[] {
  const cursors = buildCursors(panel);
  const out: BreadthDay[] = [];

  for (const date of dates) {
    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    let aboveMa50 = 0;
    let maShortCounted = 0;
    let aboveMa200 = 0;
    let maLongCounted = 0;
    let newHighs = 0;
    let newLows = 0;
    let extremesCounted = 0;
    let upVolume = 0;
    let downVolume = 0;
    const returns: number[] = [];

    for (const cursor of cursors.values()) {
      const i = cursor.indexByDate.get(date);
      if (i === undefined || i === 0) continue;
      const today = cursor.points[i];
      const prev = cursor.points[i - 1];
      if (!(today.close > 0) || !(prev.close > 0)) continue;

      const ret = today.close / prev.close - 1;
      returns.push(ret);
      if (ret > 0) {
        advancers++;
        upVolume += today.volume ?? 0;
      } else if (ret < 0) {
        decliners++;
        downVolume += today.volume ?? 0;
      } else {
        unchanged++;
      }

      // Moving averages use only closes at or before this date, so a value is
      // never informed by a price the market had not printed yet.
      if (i + 1 >= MA_SHORT) {
        const window = cursor.points.slice(i + 1 - MA_SHORT, i + 1);
        maShortCounted++;
        if (today.close > mean(window.map((p) => p.close))) aboveMa50++;
      }
      if (i + 1 >= MA_LONG) {
        const window = cursor.points.slice(i + 1 - MA_LONG, i + 1);
        maLongCounted++;
        if (today.close > mean(window.map((p) => p.close))) aboveMa200++;
      }
      if (i + 1 >= WEEKS_52) {
        const window = cursor.points.slice(i + 1 - WEEKS_52, i + 1).map((p) => p.close);
        extremesCounted++;
        const high = Math.max(...window);
        const low = Math.min(...window);
        if (today.close >= high) newHighs++;
        if (today.close <= low) newLows++;
      }
    }

    const counted = advancers + decliners + unchanged;
    if (counted === 0) continue;
    const sortedReturns = [...returns].sort((a, b) => a - b);

    out.push({
      trade_date: date,
      counted,
      advancers,
      decliners,
      unchanged,
      advance_share: counted > 0 ? advancers / counted : null,
      pct_above_ma50: maShortCounted > 0 ? aboveMa50 / maShortCounted : null,
      pct_above_ma200: maLongCounted > 0 ? aboveMa200 / maLongCounted : null,
      new_highs_52w: extremesCounted > 0 ? newHighs : null,
      new_lows_52w: extremesCounted > 0 ? newLows : null,
      median_return: sortedReturns.length ? median(sortedReturns) : null,
      return_dispersion: sortedReturns.length > 1 ? stdev(sortedReturns) : null,
      up_volume: upVolume > 0 ? upVolume : null,
      down_volume: downVolume > 0 ? downVolume : null,
    });
  }

  return out;
}
