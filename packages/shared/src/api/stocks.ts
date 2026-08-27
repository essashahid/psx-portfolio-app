/**
 * Contracts for the existing stock endpoints, typed so the mobile screens are
 * checked against them.
 *
 * These describe GET /api/stocks and GET /api/stocks/[ticker], which the web
 * screener and company page already use. Nothing about those routes changed;
 * this is the shape they were always returning, written down.
 */

export type VerificationStatus = "verified" | "unverified" | "stale" | "mismatch";

export interface StockRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  dayChangePct: number | null;
  marketCap: number | null;
  asOf: string | null;
  pe: number | null;
  eps: number | null;
  pb: number | null;
  dividendYield: number | null;
  /**
   * The period the valuation rests on. A value starting with "TTM" is trailing
   * twelve months; anything else means the ratio comes from that period alone
   * and may be stale.
   */
  basis: string | null;
  verified: VerificationStatus;
}

export interface StocksResponse {
  total: number;
  returned: number;
  offset: number;
  stocks: StockRow[];
}

export interface CompanyQuote {
  price: number | null;
  prevClose: number | null;
  dayChangePct: number | null;
  marketCap: number | null;
  asOf: string | null;
  provider: string | null;
}

export interface CompanyRatio {
  name: string;
  value: number | string | null;
  /** The period the ratio is struck on, e.g. "TTM to 2026 9M". */
  period?: string | null;
  unit?: string | null;
  [key: string]: unknown;
}

/**
 * Hand-verification metadata. This is an object, not a bare status string: the
 * note explains why a figure was accepted or demoted, and the basis says
 * whether it is struck on consolidated or standalone accounts, which can move a
 * P/E by a factor of two.
 */
export interface CompanyVerification {
  status: VerificationStatus;
  throughPeriod?: string | null;
  source?: string | null;
  basis?: string | null;
  note?: string | null;
}

export interface CompanyPayout {
  date: string | null;
  kind: string | null;
  dps: number | null;
  percentage: number | null;
}

/** The caller's own position, when they hold the company. */
export interface CompanyPosition {
  quantity: number;
  avgCost: number | null;
  totalCost: number | null;
  notes: string | null;
  /** Hidden positions are excluded from every analysis surface. */
  hidden: boolean;
}

export interface CompanyResponse {
  ticker: string;
  name: string | null;
  sector: string | null;
  quote: CompanyQuote | null;
  verified: CompanyVerification | null;
  periods: { latestAnnual: string | null; latestInterim: string | null };
  priceUsed: number | null;
  ratios: CompanyRatio[];
  payouts: CompanyPayout[];
  position: CompanyPosition | null;
  watched: boolean;
}
