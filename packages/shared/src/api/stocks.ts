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
  unit?: string | null;
  source_period?: string | null;
  [key: string]: unknown;
}

export interface CompanyPayout {
  date: string | null;
  kind: string | null;
  dps: number | null;
  percentage: number | null;
}

export interface CompanyResponse {
  ticker: string;
  name: string | null;
  sector: string | null;
  quote: CompanyQuote | null;
  verified: VerificationStatus | null;
  periods: { latestAnnual: string | null; latestInterim: string | null };
  priceUsed: number | null;
  ratios: CompanyRatio[];
  payouts: CompanyPayout[];
}
