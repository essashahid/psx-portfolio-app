import { buildLedgerRows, deriveCashBalance } from "@/lib/engine/ledger-view";

const txn = (over: Partial<Parameters<typeof buildLedgerRows>[0][number]> = {}) => ({
  id: "t1",
  trade_date: "2026-01-10",
  type: "BUY",
  ticker: "OGDC",
  quantity: 100,
  price: 200,
  net_amount: 20050,
  notes: null,
  ...over,
});

describe("buildLedgerRows", () => {
  it("debits a buy and credits a sell", () => {
    const { rows, closingBalance } = buildLedgerRows(
      [txn(), txn({ id: "t2", type: "SELL", trade_date: "2026-01-11", net_amount: 25000 })],
      []
    );
    expect(rows[0].debit).toBe(20050);
    expect(rows[1].credit).toBe(25000);
    expect(closingBalance).toBe(4950);
  });

  it("falls back to consideration when net_amount was never stored", () => {
    // The transactions route accepts a trade without net_amount. Treating that
    // as zero would report cash the account does not have.
    const { rows, closingBalance } = buildLedgerRows([txn({ net_amount: null })], []);
    expect(rows[0].debit).toBe(20000);
    expect(closingBalance).toBe(-20000);
  });

  it("leaves a row at zero when there is no way to price it", () => {
    const { rows } = buildLedgerRows([txn({ net_amount: null, price: null })], []);
    expect(rows[0].debit).toBe(0);
  });

  it("keeps a stored zero rather than inventing a figure", () => {
    const { rows } = buildLedgerRows([txn({ net_amount: 0 })], []);
    expect(rows[0].debit).toBe(0);
  });

  it("runs the balance in date order across both halves of the ledger", () => {
    const balance = deriveCashBalance(
      [txn({ trade_date: "2026-01-10" })],
      [{ id: "c1", movement_date: "2026-01-05", type: "CASH_IN", amount: 50000, description: null }]
    );
    expect(balance).toBe(29950);
  });
});
