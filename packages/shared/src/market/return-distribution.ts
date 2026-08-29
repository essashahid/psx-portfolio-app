/**
 * How the whole market moved today, and where your holdings sat in it.
 *
 * One 1%-wide bucket per step from −6% to +6%, tails open, so the shape is
 * comparable from day to day rather than rescaling itself. The point is not
 * the distribution: it is that your own tickers are marked inside it, which is
 * what turns "I am down 2%" into "so is everything else" or "everything else
 * is up".
 */

export interface ReturnBucket {
  /** Inclusive lower bound, in percent. The lowest bucket has an open tail. */
  lo: number;
  /** Exclusive upper bound. The highest bucket has an open tail. */
  hi: number;
  count: number;
  /** The caller's own tickers that landed here. */
  mine: string[];
}

export interface ReturnDistribution {
  buckets: ReturnBucket[];
  total: number;
  best: { ticker: string; pct: number } | null;
  worst: { ticker: string; pct: number } | null;
}

const EDGES = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

export function buildReturnDistribution(
  changes: { ticker: string; pct: number }[],
  ownedTickers: Iterable<string>
): ReturnDistribution {
  const owned = new Set(ownedTickers);
  const buckets: ReturnBucket[] = EDGES.slice(0, -1).map((lo, i) => ({
    lo,
    hi: EDGES[i + 1],
    count: 0,
    mine: [],
  }));

  let best: { ticker: string; pct: number } | null = null;
  let worst: { ticker: string; pct: number } | null = null;

  for (const change of changes) {
    if (!Number.isFinite(change.pct)) continue;
    // Clamped rather than dropped: a company down 11% belongs in the leftmost
    // bar, not missing from the count of how many fell.
    const index = Math.min(buckets.length - 1, Math.max(0, Math.floor(change.pct) + 6));
    buckets[index].count += 1;
    if (owned.has(change.ticker)) buckets[index].mine.push(change.ticker);
    if (!best || change.pct > best.pct) best = { ticker: change.ticker, pct: change.pct };
    if (!worst || change.pct < worst.pct) worst = { ticker: change.ticker, pct: change.pct };
  }

  return {
    buckets,
    total: buckets.reduce((sum, b) => sum + b.count, 0),
    best,
    worst,
  };
}
