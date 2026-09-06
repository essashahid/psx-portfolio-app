/**
 * The contract for GET /api/portfolio/holdings.
 *
 * Deliberately not the server's internal shapes. The web holdings page reads
 * EnrichedHolding and DailyHoldingPerformance separately and joins them in the
 * component; the mobile app gets that join done once on the server, in the
 * fields it actually shows. Both apps import this type, so a change to the
 * route that the screen has not caught up with is a typecheck failure rather
 * than a blank row on a phone.
 */

export interface HoldingRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  quantity: number;
  avgCost: number | null;
  totalCost: number | null;
  latestPrice: number | null;
  priceDate: string | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
  /** Share of the portfolio, 0 to 100. */
  weight: number | null;
  /** Today's move. Null when the position has no fresh price. */
  dayChangePct: number | null;
  dayPnl: number | null;
  dividendIncome: number;
  /** From the shared palette, so one sector is one colour everywhere. */
  color: string;
}

export interface HoldingsResponse {
  /**
   * Companies sold out of, newest first. Sent so the phone can show the same
   * record the web does: selling closes a position, it does not erase that it
   * was owned.
   */
  closed?: ClosedPositionRow[];
  rows: HoldingRow[];
  totalValue: number;
  totalCost: number;
  unrealizedPl: number;
  unrealizedPlPct: number | null;
  /** Date the day-change figures are measured against, null when unavailable. */
  asOf: string | null;
  totalDayPnl: number | null;
  /** Weighted move across the book today, 0 to 100. */
  dayChangePct: number | null;
  /** How many positions carry a usable price, for an honest "as of" line. */
  pricedCount: number;
  count: number;
  /** Positions worth less than they cost. Null when nothing is priced. */
  belowCostCount: number | null;
  /** Sector filter rail: one entry per sector held, largest first. */
  sectorFilters: { sector: string; label: string; color: string; count: number }[];
}

/** A company no longer held, with what it earned over the time it was. */
export interface ClosedPositionRow {
  ticker: string;
  sold: number;
  realizedPl: number;
  realizedPct: number | null;
  lastSell: string | null;
  heldDays: number | null;
}

/**
 * The request contract for PATCH /api/holdings/[ticker].
 *
 * A quantity or average-cost change becomes an adjusting ledger entry; notes
 * are written to the position itself. `hidden` is handled on its own and the
 * route returns early after flipping it, so send it in a separate request
 * from the other fields.
 */
export interface HoldingPatchRequest {
  quantity?: number;
  avg_cost?: number;
  notes?: string;
  hidden?: boolean;
}
