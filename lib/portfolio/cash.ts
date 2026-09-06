/**
 * Broker cash on hand, derived from the ledger so it always reconciles.
 *
 * Deposits, dividends credited to the account and sale proceeds add; buys,
 * rights subscriptions, withdrawals, fees and CGT subtract. One function so
 * the dashboard, the phone and the reconciliation script cannot drift apart.
 */
export interface CashMovementLike {
  type: string | null;
  amount: number | string | null;
  date?: string | null;
}

export interface CashTxnLike {
  type: string | null;
  net_amount: number | string | null;
  trade_date?: string | null;
}

export function computeCashBalance(
  movements: CashMovementLike[],
  transactions: CashTxnLike[],
  /** Only rows dated on or before this ISO date count; omit for "now". */
  asOf?: string | null
): number {
  let cash = 0;
  for (const c of movements) {
    if (asOf && c.date && c.date > asOf) continue;
    const amt = Number(c.amount ?? 0);
    if (c.type === "CASH_IN" || c.type === "DIVIDEND") cash += Math.abs(amt);
    else if (c.type === "CASH_OUT" || c.type === "FEE" || c.type === "TAX") cash -= Math.abs(amt);
    else cash += amt;
  }
  for (const t of transactions) {
    if (asOf && t.trade_date && t.trade_date > asOf) continue;
    const net = Math.abs(Number(t.net_amount ?? 0));
    if (t.type === "SELL") cash += net;
    else if (t.type === "BUY" || t.type === "RIGHT") cash -= net;
  }
  return cash;
}
