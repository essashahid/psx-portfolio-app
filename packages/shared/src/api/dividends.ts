import type { YieldOnCostRow } from "../dividends/yield-on-cost";

/**
 * The contract for GET /api/portfolio/dividends.
 *
 * Grouped by Pakistan tax year (1 July to 30 June) rather than calendar year,
 * because that is the boundary that matters for what he owes. taxYearOf in
 * @psx/shared/dividends/tax-year is the single definition of that split and
 * both apps use it.
 */

export interface DividendRow {
  id: string;
  ticker: string | null;
  companyName: string | null;
  payDate: string | null;
  exDate: string | null;
  perShare: number | null;
  quantityHeld: number | null;
  /** Gross amount. netAmount is after tax withheld. */
  amount: number;
  tax: number | null;
  netAmount: number | null;
  status: "announced" | "expected" | "received" | "missing";
}

export interface DividendTaxYear {
  /** e.g. "2025-26". */
  taxYear: string;
  gross: number;
  tax: number;
  net: number;
  count: number;
}

export interface DividendsResponse {
  /** Cash actually received, all time. */
  receivedTotal: number;
  receivedNetTotal: number;
  /** Announced or expected but not yet paid. */
  upcomingTotal: number;
  byTaxYear: DividendTaxYear[];
  /** Most recent payments first. */
  recent: DividendRow[];
  /** Announced or expected, soonest first. */
  upcoming: DividendRow[];
  taxRatePct: number | null;
  /**
   * What each holding pays against what you paid for it. Highest first, and
   * only holdings that actually paid in the last year.
   */
  yieldOnCost: YieldOnCostRow[];
  count: number;
}

/**
 * The request contract for POST, PATCH and DELETE /api/dividends.
 *
 * POST and PATCH take the same shape; PATCH additionally requires `id`. Dates
 * are YYYY-MM-DD. `amount` is gross, `tax` is what was withheld, and the route
 * derives `net_amount` when it is not sent.
 */
export interface DividendWriteRequest {
  /** Required for PATCH, ignored for POST. */
  id?: string;
  ticker: string;
  company_name?: string | null;
  announcement_date?: string | null;
  ex_date?: string | null;
  payment_date?: string | null;
  dividend_per_share?: number | null;
  quantity_held?: number | null;
  amount: number;
  tax?: number | null;
  net_amount?: number | null;
  /** Defaults to "received" when omitted. */
  status?: DividendRow["status"];
  notes?: string | null;
}

export interface DividendDeleteRequest {
  id: string;
}
