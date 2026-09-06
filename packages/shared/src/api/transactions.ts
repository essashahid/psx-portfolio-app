/**
 * The request contracts for POST /api/transactions and PATCH /api/transactions/[id].
 *
 * These mirror the zod schemas in the route handlers, which remain the runtime
 * check. The types exist so the phone's sheet and the route agree at compile
 * time: a field renamed on one side fails the typecheck on the other.
 */

export type TransactionType = "BUY" | "SELL" | "DIVIDEND" | "BONUS" | "RIGHT" | "SPLIT" | "ADJUST";

/** What POST /api/transactions accepts. A DIVIDEND here lands in the dividends ledger. */
export interface TransactionWriteRequest {
  ticker: string;
  /** YYYY-MM-DD. */
  trade_date: string;
  type: TransactionType;
  quantity?: number;
  price?: number;
  commission?: number;
  tax?: number;
  net_amount?: number;
  notes?: string;
}

/**
 * What PATCH /api/transactions/[id] accepts. Every field is optional and null
 * clears a stored value. DIVIDEND is not a valid type here because a dividend
 * row is owned by the dividends ledger, not the transactions table.
 */
export interface TransactionPatchRequest {
  ticker?: string;
  trade_date?: string;
  type?: Exclude<TransactionType, "DIVIDEND">;
  quantity?: number;
  price?: number | null;
  commission?: number | null;
  tax?: number | null;
  net_amount?: number | null;
  notes?: string | null;
}
