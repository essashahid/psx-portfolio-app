/**
 * The request contracts for POST /api/cash-movements and PATCH /api/cash-movements/[id].
 *
 * The amount is always positive; the type carries the direction. The route's
 * zod schema is the runtime check and these types mirror it.
 */

export type CashMovementType = "CASH_IN" | "CASH_OUT" | "FEE" | "TAX" | "DIVIDEND";

export interface CashMovementWriteRequest {
  /** YYYY-MM-DD. */
  movement_date: string;
  type: CashMovementType;
  /** Positive. The type says which way the cash moved. */
  amount: number;
  description?: string;
}

/** Partial update. Null clears the description. */
export interface CashMovementPatchRequest {
  movement_date?: string;
  type?: CashMovementType;
  amount?: number;
  description?: string | null;
}
