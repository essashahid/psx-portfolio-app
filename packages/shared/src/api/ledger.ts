/**
 * The contract for GET /api/portfolio/ledger.
 *
 * The rows are the same chronological statement the web performance page
 * shows, built by buildLedgerRows, so both apps read one ledger rather than
 * two views that can drift. Newest first here, because a phone reads down from
 * the most recent entry.
 */

export type LedgerEntryKind = "DEPOSIT" | "WITHDRAWAL" | "TRADE" | "CHARGE" | "ADJUSTMENT";

export interface LedgerEntry {
  id: string;
  refType: "transaction" | "cash_movement";
  date: string | null;
  kind: LedgerEntryKind;
  ticker: string | null;
  narration: string;
  debit: number;
  credit: number;
  /** Running cash on hand after this entry. */
  balance: number;
}

/** The stored fields behind a row, so an edit sheet opens already filled in. */
export interface LedgerTxnDetail {
  id: string;
  trade_date: string | null;
  type: string;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  commission: number | null;
  tax: number | null;
  net_amount: number | null;
  notes: string | null;
}

export interface LedgerCashDetail {
  id: string;
  movement_date: string | null;
  type: string;
  amount: number;
  description: string | null;
}

export interface LedgerResponse {
  entries: LedgerEntry[];
  transactions: LedgerTxnDetail[];
  cashMovements: LedgerCashDetail[];
  /** Cash on hand after the last entry. */
  closingBalance: number;
  count: number;
}
