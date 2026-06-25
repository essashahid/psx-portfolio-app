import { cpiForDate } from "@/lib/market-data/pbs-cpi";

/**
 * "Growth of invested capital" benchmark series.
 *
 * Four money-weighted lines driven off the investor's real, dated contribution
 * stream so every strategy starts from the same cash on the same days:
 *
 *  - contributed: cumulative external capital put in (the baseline).
 *  - portfolio:   actual account value = held shares at market + broker cash.
 *  - kse100:      every contribution instead buys the KSE-100 (total return)
 *                 on its date and is held to each later date.
 *  - inflation:   every contribution merely keeps pace with PBS National CPI.
 *
 * The engine is pure: it knows nothing about AKD, splits or mergers. The caller
 * supplies share events already expressed in current (split-adjusted) units and
 * the cash series, so the held-share valuation lines up with split-adjusted
 * price history.
 */

export interface Contribution {
  date: string; // YYYY-MM-DD
  amount: number; // positive PKR put in
}

export interface ShareEvent {
  date: string; // YYYY-MM-DD
  ticker: string;
  qtyDelta: number; // + buy/IPO/conversion in, - sell, in current (adjusted) units
}

export interface ClosePoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export interface BenchmarkInputs {
  contributions: Contribution[];
  shareEvents: ShareEvent[];
  /** Running broker cash on hand after each dated ledger move, sorted ascending. */
  cashSeries: ClosePoint[]; // close = cash on hand
  /** Daily close history per ticker, oldest first. */
  priceSeries: Map<string, ClosePoint[]>;
  /** KSE-100 (total return) daily close history, oldest first. */
  kse100: ClosePoint[];
  /** Last actual date to value at (statement end / today). */
  asOf: string;
}

export interface BenchmarkPoint {
  date: string; // YYYY-MM-DD
  contributed: number;
  portfolio: number;
  kse100: number;
  inflation: number;
  cpi: number; // National CPI index at this date, for real-value mode
}

/** Last close on or before `date`, or null if the series starts later. */
function closeAsOf(series: ClosePoint[], date: string): number | null {
  let chosen: number | null = null;
  for (const point of series) {
    if (point.date <= date) chosen = point.close;
    else break;
  }
  return chosen;
}

/** Last day of the month for an ISO date, clamped to `cap` if earlier. */
function monthEnd(year: number, monthIndex0: number, cap: string): string {
  const last = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  const iso = last.toISOString().slice(0, 10);
  return iso > cap ? cap : iso;
}

/** Ascending month-end checkpoints from the first contribution through asOf. */
function monthlyCheckpoints(start: string, asOf: string): string[] {
  const [sy, sm] = start.split("-").map(Number);
  const dates: string[] = [];
  let y = sy;
  let m = sm - 1; // 0-based
  while (true) {
    const point = monthEnd(y, m, asOf);
    dates.push(point);
    if (point >= asOf) break;
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    if (y > 2100) break; // safety
  }
  // De-dup (the clamped final month can equal asOf).
  return [...new Set(dates)];
}

export function buildBenchmarkSeries(inputs: BenchmarkInputs): BenchmarkPoint[] {
  const { contributions, shareEvents, cashSeries, priceSeries, kse100, asOf } = inputs;
  if (contributions.length === 0) return [];

  const sortedContribs = [...contributions].sort((a, b) => a.date.localeCompare(b.date));
  const sortedEvents = [...shareEvents].sort((a, b) => a.date.localeCompare(b.date));
  const start = sortedContribs[0].date;
  const checkpoints = monthlyCheckpoints(start, asOf);

  // Pre-resolve each contribution's KSE level and CPI on its own date.
  const contribMeta = sortedContribs.map((c) => ({
    date: c.date,
    amount: c.amount,
    kseAtBuy: closeAsOf(kse100, c.date),
    cpiAtBuy: cpiForDate(c.date),
  }));

  return checkpoints.map((date) => {
    // contributed + benchmark equivalents from contributions made so far
    let contributed = 0;
    let kseEquiv = 0;
    let inflationEquiv = 0;
    const kseNow = closeAsOf(kse100, date);
    const cpiNow = cpiForDate(date);
    for (const c of contribMeta) {
      if (c.date > date) break;
      contributed += c.amount;
      if (kseNow !== null && c.kseAtBuy && c.kseAtBuy > 0) {
        kseEquiv += c.amount * (kseNow / c.kseAtBuy);
      } else {
        kseEquiv += c.amount; // no index yet — hold at cost
      }
      inflationEquiv += c.amount * (cpiNow / c.cpiAtBuy);
    }

    // actual portfolio: held shares at market + broker cash
    const qtyByTicker = new Map<string, number>();
    for (const e of sortedEvents) {
      if (e.date > date) break;
      qtyByTicker.set(e.ticker, (qtyByTicker.get(e.ticker) ?? 0) + e.qtyDelta);
    }
    let holdingsValue = 0;
    for (const [ticker, qty] of qtyByTicker) {
      if (qty <= 0) continue;
      const series = priceSeries.get(ticker);
      const close = series ? closeAsOf(series, date) : null;
      if (close !== null) holdingsValue += qty * close;
    }
    const cash = closeAsOf(cashSeries, date) ?? 0;

    return {
      date,
      contributed: round2(contributed),
      portfolio: round2(holdingsValue + cash),
      kse100: round2(kseEquiv),
      inflation: round2(inflationEquiv),
      cpi: cpiNow,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
