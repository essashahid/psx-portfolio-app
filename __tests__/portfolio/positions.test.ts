import { rebuildHoldings } from "../../lib/portfolio/positions";

/**
 * Cost basis and realised P/L had no test, which made them the most
 * consequential untested code in the app: every figure on the dashboard,
 * holdings and performance pages is derived from this function.
 *
 * rebuildHoldings is pure, so it tests directly. getPortfolio and
 * recomputeHoldingsFromTransactions around it take a Supabase client and are
 * left for an integration pass.
 */

type Txn = Parameters<typeof rebuildHoldings>[0][number];

const txn = (over: Partial<Txn> & Pick<Txn, "ticker" | "type">): Txn => ({
  trade_date: "2026-01-01",
  quantity: null,
  price: null,
  gross_amount: null,
  commission: null,
  tax: null,
  net_amount: null,
  ...over,
});

const pos = (t: Txn[], ticker: string) => rebuildHoldings(t).positions.get(ticker);

describe("rebuildHoldings: buying", () => {
  test("a single buy holds quantity at the price paid", () => {
    const p = pos([txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 120 })], "HBL");
    expect(p?.quantity).toBe(100);
    expect(p?.totalCost).toBe(12_000);
    expect(p?.avgCost).toBe(120);
  });

  test("commission and tax are part of the cost, so they raise the average", () => {
    const p = pos([txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 120, commission: 150, tax: 50 })], "HBL");
    expect(p?.totalCost).toBe(12_200);
    expect(p?.avgCost).toBe(122);
  });

  test("net_amount wins over the computed cost when the broker states it", () => {
    // The statement is the authority: it already includes whatever the broker
    // charged, which may not equal qty*price plus the fees we can see.
    const p = pos([txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 120, net_amount: 12_345 })], "HBL");
    expect(p?.totalCost).toBe(12_345);
    expect(p?.avgCost).toBeCloseTo(123.45, 6);
  });

  test("two buys average by weight, not by simple mean", () => {
    const p = pos([
      txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" }),
      txn({ ticker: "HBL", type: "BUY", quantity: 300, price: 140, trade_date: "2026-02-01" }),
    ], "HBL");
    expect(p?.quantity).toBe(400);
    expect(p?.totalCost).toBe(52_000);
    expect(p?.avgCost).toBe(130); // not 120
  });

  test("transactions out of date order are replayed in date order", () => {
    const late = txn({ ticker: "HBL", type: "BUY", quantity: 300, price: 140, trade_date: "2026-02-01" });
    const early = txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" });
    expect(pos([late, early], "HBL")?.avgCost).toBe(pos([early, late], "HBL")?.avgCost);
  });
});

describe("rebuildHoldings: selling", () => {
  const buyThenSell = (sell: Partial<Txn>) => [
    txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" }),
    txn({ ticker: "HBL", type: "SELL", quantity: 40, price: 150, trade_date: "2026-03-01", ...sell }),
  ];

  test("a sell reduces quantity and realises the gain against average cost", () => {
    const p = pos(buyThenSell({}), "HBL");
    expect(p?.quantity).toBe(60);
    expect(p?.realizedPl).toBe(2_000); // 40 * (150 - 100)
  });

  test("selling does not move the average cost of what is left", () => {
    const p = pos(buyThenSell({}), "HBL");
    expect(p?.avgCost).toBe(100);
    expect(p?.totalCost).toBe(6_000);
  });

  test("fees on a sell reduce the realised gain", () => {
    const p = pos(buyThenSell({ commission: 200, tax: 100 }), "HBL");
    expect(p?.realizedPl).toBe(1_700);
  });

  test("a sale below cost realises a loss", () => {
    const p = pos(buyThenSell({ price: 80 }), "HBL");
    expect(p?.realizedPl).toBe(-800); // 40 * (80 - 100)
  });

  test("selling the whole position leaves nothing but keeps the realised result", () => {
    const p = pos([
      txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" }),
      txn({ ticker: "HBL", type: "SELL", quantity: 100, price: 130, trade_date: "2026-03-01" }),
    ], "HBL");
    expect(p?.quantity).toBe(0);
    expect(p?.totalCost).toBe(0);
    expect(p?.realizedPl).toBe(3_000);
  });

  test("realised results accumulate across several sells", () => {
    const p = pos([
      txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" }),
      txn({ ticker: "HBL", type: "SELL", quantity: 30, price: 150, trade_date: "2026-02-01" }),
      txn({ ticker: "HBL", type: "SELL", quantity: 30, price: 50, trade_date: "2026-03-01" }),
    ], "HBL");
    expect(p?.realizedPl).toBe(1_500 - 1_500);
    expect(p?.quantity).toBe(40);
  });
});

describe("rebuildHoldings: corporate actions", () => {
  test("a bonus issue adds shares without adding cost, so the average falls", () => {
    const p = pos([
      txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" }),
      txn({ ticker: "HBL", type: "BONUS", quantity: 25, trade_date: "2026-02-01" }),
    ], "HBL");
    expect(p?.quantity).toBe(125);
    expect(p?.totalCost).toBe(10_000);
    expect(p?.avgCost).toBe(80);
  });

  test("a rights issue adds shares at what was paid for them", () => {
    const p = pos([
      txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" }),
      txn({ ticker: "HBL", type: "RIGHT", quantity: 50, price: 40, trade_date: "2026-02-01" }),
    ], "HBL");
    expect(p?.quantity).toBe(150);
    expect(p?.totalCost).toBe(12_000);
    expect(p?.avgCost).toBe(80);
  });
});

describe("rebuildHoldings: several holdings and edge cases", () => {
  test("positions are kept apart by ticker", () => {
    const t = [
      txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100 }),
      txn({ ticker: "OGDC", type: "BUY", quantity: 50, price: 200 }),
    ];
    expect(pos(t, "HBL")?.totalCost).toBe(10_000);
    expect(pos(t, "OGDC")?.totalCost).toBe(10_000);
    expect(pos(t, "OGDC")?.quantity).toBe(50);
  });

  test("an empty ledger produces no positions", () => {
    expect(rebuildHoldings([]).positions.size).toBe(0);
  });

  test("realizedByTxn lines up with the date-sorted ledger", () => {
    const { realizedByTxn } = rebuildHoldings([
      txn({ ticker: "HBL", type: "BUY", quantity: 100, price: 100, trade_date: "2026-01-01" }),
      txn({ ticker: "HBL", type: "SELL", quantity: 50, price: 120, trade_date: "2026-02-01" }),
    ]);
    expect(realizedByTxn).toHaveLength(2);
    expect(realizedByTxn[1]).toBe(1_000);
  });
});
