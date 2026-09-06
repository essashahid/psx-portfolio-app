/**
 * Plain-language summaries of a market day, computed once on the server so
 * the web Market page and the phone read the same words and the same numbers.
 *
 * Both helpers are pure. They take the per-company rows of the snapshot (with
 * market cap, so the answers are value-weighted rather than a raw count) and
 * return either a sentence or a short table. No I/O, no formatting beyond
 * rounding, so they are cheap to test with fixed inputs.
 */

export interface SummaryRow {
  ticker: string;
  /** Company name, when the snapshot carries one. */
  name?: string | null;
  /** Short sector label, already resolved by the caller. */
  sectorLabel: string;
  changePct: number | null;
  marketCap: number;
}

export interface IndexContributor {
  ticker: string;
  name: string | null;
  /** Index points this company added (positive) or took away (negative). */
  points: number;
  changePct: number | null;
}

/** A move smaller than this is treated as unchanged when counting advancers. */
const FLAT_THRESHOLD_PCT = 0.05;

/** Default number of contributors to return. */
export const CONTRIBUTOR_LIMIT = 7;

/**
 * One sentence on the day: how many companies rose or fell, what share of
 * market value sat in names that gained, and which sector carried or weighed
 * on the market most (cap-weighted).
 *
 * Returns null when there is nothing to describe (no priced rows).
 */
export function marketVerdict(rows: SummaryRow[]): string | null {
  const priced = rows.filter((r) => Number.isFinite(r.marketCap) && r.marketCap > 0);
  if (priced.length === 0) return null;

  const advanced = priced.filter((r) => (r.changePct ?? 0) > FLAT_THRESHOLD_PCT).length;
  const declined = priced.filter((r) => (r.changePct ?? 0) < -FLAT_THRESHOLD_PCT).length;
  const capTotal = priced.reduce((n, r) => n + r.marketCap, 0);
  const rising = priced.filter((r) => (r.changePct ?? 0) > 0).reduce((n, r) => n + r.marketCap, 0);
  const share = Math.round((rising / capTotal) * 100);

  const bySector = new Map<string, { cap: number; weighted: number }>();
  for (const r of priced) {
    const g = bySector.get(r.sectorLabel) ?? { cap: 0, weighted: 0 };
    g.cap += r.marketCap;
    g.weighted += (r.changePct ?? 0) * r.marketCap;
    bySector.set(r.sectorLabel, g);
  }
  const ranked = [...bySector.entries()]
    .map(([label, g]) => ({ label, move: g.weighted / g.cap }))
    .sort((a, b) => b.move - a.move);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const total = priced.length;
  const companies = (n: number) => `${n} of ${total} ${total === 1 ? "company" : "companies"}`;

  let sectors: string;
  if (ranked.length < 2 || best.label === worst.label) {
    sectors = `${best.label} set the tone.`;
  } else if (advanced > declined) {
    sectors = `${best.label} carried the market and ${worst.label} weighed most on it.`;
  } else if (declined > advanced) {
    sectors = `${worst.label} weighed most on the market and ${best.label} held up best.`;
  } else {
    sectors = `${best.label} led and ${worst.label} lagged.`;
  }

  if (advanced > declined) {
    return `${companies(advanced)} rose and ${share}% of market value sits in names that gained. ${sectors}`;
  }
  if (declined > advanced) {
    return `${companies(declined)} fell and only ${share}% of market value sits in names that gained. ${sectors}`;
  }
  return `A mixed day: ${advanced} ${advanced === 1 ? "company" : "companies"} rose and ${declined} fell, with ${share}% of market value in names that gained. ${sectors}`;
}

/**
 * Index points each company moved: its weight in the covered market value
 * times its own move, scaled to the index level. Sorted by absolute
 * contribution, largest first, capped at `limit`.
 *
 * The weights are relative to the rows supplied, which is the snapshot's
 * coverage rather than the exchange's own free-float weighting, so the points
 * are an approximation and are labelled as such where they are shown.
 */
export function indexContributors(rows: SummaryRow[], indexLevel: number | null, limit = CONTRIBUTOR_LIMIT): IndexContributor[] {
  if (!indexLevel || !Number.isFinite(indexLevel) || indexLevel <= 0) return [];
  const priced = rows.filter((r) => Number.isFinite(r.marketCap) && r.marketCap > 0);
  if (priced.length === 0) return [];
  const capTotal = priced.reduce((n, r) => n + r.marketCap, 0);
  if (capTotal <= 0) return [];
  return priced
    .map((r) => ({
      ticker: r.ticker,
      name: r.name ?? null,
      points: (r.marketCap / capTotal) * ((r.changePct ?? 0) / 100) * indexLevel,
      changePct: r.changePct,
    }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, Math.max(0, limit));
}
