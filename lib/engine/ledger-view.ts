/**
 * Virtual ledger view.
 *
 * Merges the two halves of the user's ledger — `transactions` (trades, splits,
 * adjustments) and `cash_movements` (Raast deposits, withdrawals, fees, CGT) —
 * into one chronological statement with debit/credit columns and a running cash
 * balance, the way the AKD Statement of Account reads. This is the single
 * presentation of the source of truth; holdings and analytics are derived from
 * the same rows.
 *
 * Cash convention: balance is cash on hand. Deposits and sale proceeds are
 * credits (+); buys, fees, CGT and withdrawals are debits (−). The closing
 * balance equals the broker ledger balance.
 */

export interface LedgerTxnInput {
  id: string;
  trade_date: string | null;
  type: string;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  net_amount: number | null;
  notes: string | null;
}

export interface LedgerCashInput {
  id: string;
  movement_date: string | null;
  type: string;
  amount: number;
  description: string | null;
}

export type LedgerRowKind = "DEPOSIT" | "WITHDRAWAL" | "TRADE" | "CHARGE" | "ADJUSTMENT";

export interface LedgerRow {
  id: string;
  refType: "transaction" | "cash_movement";
  date: string | null;
  kind: LedgerRowKind;
  ticker: string | null;
  narration: string;
  debit: number; // cash out (0 if none)
  credit: number; // cash in (0 if none)
  balance: number; // running cash on hand after this row
  editable: boolean;
}

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const fmtPrice = (n: number | null) => (n == null ? "" : n.toLocaleString("en-PK", { maximumFractionDigits: 2 }));

function txnRow(t: LedgerTxnInput): Omit<LedgerRow, "balance"> {
  const qty = Number(t.quantity ?? 0);
  const net = Number(t.net_amount ?? 0);
  const tk = t.ticker ?? "";
  switch (t.type) {
    case "BUY":
    case "RIGHT":
      return { id: t.id, refType: "transaction", date: t.trade_date, kind: "TRADE", ticker: tk,
        narration: `Buy ${fmtQty(Math.abs(qty))} ${tk} @ ${fmtPrice(t.price)}`.trim(), debit: net, credit: 0, editable: true };
    case "SELL":
      return { id: t.id, refType: "transaction", date: t.trade_date, kind: "TRADE", ticker: tk,
        narration: `Sell ${fmtQty(Math.abs(qty))} ${tk} @ ${fmtPrice(t.price)}`.trim(), debit: 0, credit: net, editable: true };
    case "SPLIT":
      return { id: t.id, refType: "transaction", date: t.trade_date, kind: "ADJUSTMENT", ticker: tk,
        narration: `${tk} stock split ${fmtQty(qty)}-for-1`, debit: 0, credit: 0, editable: true };
    case "BONUS":
      return { id: t.id, refType: "transaction", date: t.trade_date, kind: "ADJUSTMENT", ticker: tk,
        narration: `${tk} bonus ${fmtQty(qty)} shares`, debit: 0, credit: 0, editable: true };
    case "ADJUST":
      return { id: t.id, refType: "transaction", date: t.trade_date, kind: "ADJUSTMENT", ticker: tk,
        narration: t.notes?.trim() || `Adjustment ${qty > 0 ? "+" : ""}${fmtQty(qty)} ${tk}`, debit: 0, credit: 0, editable: true };
    default:
      return { id: t.id, refType: "transaction", date: t.trade_date, kind: "TRADE", ticker: tk,
        narration: t.notes?.trim() || `${t.type} ${tk}`, debit: 0, credit: 0, editable: true };
  }
}

function cashRow(c: LedgerCashInput): Omit<LedgerRow, "balance"> {
  const amt = Math.abs(Number(c.amount ?? 0));
  const credit = c.type === "CASH_IN" || c.type === "DIVIDEND";
  const kind: LedgerRowKind = c.type === "CASH_IN" ? "DEPOSIT" : c.type === "CASH_OUT" ? "WITHDRAWAL" : "CHARGE";
  const fallback = c.type === "CASH_IN" ? "Deposit" : c.type === "CASH_OUT" ? "Withdrawal" : c.type === "TAX" ? "CGT / tax" : "Charge";
  return {
    id: c.id, refType: "cash_movement", date: c.movement_date, kind, ticker: null,
    narration: c.description?.trim() || fallback,
    debit: credit ? 0 : amt, credit: credit ? amt : 0, editable: true,
  };
}

/** Builds the chronological ledger with a running balance. Oldest first. */
export function buildLedgerRows(
  txns: LedgerTxnInput[],
  cash: LedgerCashInput[],
  startingCash = 0
): { rows: LedgerRow[]; closingBalance: number } {
  const merged = [
    ...txns.map(txnRow),
    ...cash.map(cashRow),
  ].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  let balance = startingCash;
  const rows: LedgerRow[] = merged.map((r) => {
    balance += r.credit - r.debit;
    return { ...r, balance: Math.round(balance * 100) / 100 };
  });
  return { rows, closingBalance: Math.round(balance * 100) / 100 };
}

/** Broker cash on hand derived from the full ledger (deposits + sells − buys − fees − withdrawals). */
export function deriveCashBalance(
  txns: LedgerTxnInput[],
  cash: LedgerCashInput[],
  startingCash = 0
): number {
  return buildLedgerRows(txns, cash, startingCash).closingBalance;
}
