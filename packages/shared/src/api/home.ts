/**
 * The contract for GET /api/portfolio/home.
 *
 * The home screen shows one thing from each of four sources: the portfolio
 * total, today's move, the value curve, and where the money sits. Fetching
 * those separately would be four round trips before a phone shows anything, so
 * the join happens once on the server.
 */

export interface HomeSectorSlice {
  sector: string;
  value: number;
  /** Share of the book, 0 to 100. */
  weightPct: number;
  /** Resolved from the shared sector palette so one sector is one colour. */
  color: string;
}

export interface HomeContributor {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  color: string;
  /** Rupees added or removed today. */
  dayPnl: number | null;
  dayChangePct: number | null;
}

export interface HomeResponse {
  totalValue: number;
  totalCost: number;
  unrealizedPl: number;
  unrealizedPlPct: number | null;
  holdingsCount: number;
  dividendIncome: number;
  /** Today, across the whole book. Null when no position carries a fresh price. */
  totalDayPnl: number | null;
  dayChangePct: number | null;
  /** The timestamp the day figures are true as of. */
  asOf: string | null;
  /** True when no holding has a live price and the totals are cost, not value. */
  atCost: boolean;
  largest: { ticker: string; weightPct: number } | null;
  sectors: HomeSectorSlice[];
  /** Biggest movers today, largest absolute contribution first. */
  contributors: HomeContributor[];
  /** Net worth over time, oldest first. Empty when unavailable. */
  timeline: { date: string; netWorth: number }[];
}
