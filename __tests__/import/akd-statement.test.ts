import { isAkdStatement, reconcileAkd, type AkdStatement, type AkdTrade, type AkdEntry } from "../../lib/import/akd-statement";

/**
 * The AKD importer had no test, and it is the path a real broker statement
 * takes into the ledger.
 *
 * Two of its four exports are covered here: detection, and the reconciliation
 * that tells the reader whether the imported statement adds up. parseAkdStatement
 * itself takes pdf-parse output, and the only real statement is the owner's,
 * which is git-ignored for good reason. Writing a synthetic PDF text fixture
 * would mostly test the fixture, so that is left for a pass that can use a
 * sanitised real one.
 */

const entry = (over: Partial<AkdEntry> & Pick<AkdEntry, "kind" | "amount">): AkdEntry =>
  ({ page: 1, date: "2026-01-10", entryNo: "1", narration: "", ...over }) as AkdEntry;

const trade = (over: Partial<AkdTrade> & Pick<AkdTrade, "ticker" | "side" | "quantity" | "net">): AkdTrade =>
  ({
    page: 1, date: "2026-01-10", entryNo: "1", narration: "", kind: "TRADE",
    ref: "R1", price: 0, commission: 0, sst: 0, cdc: 0, fees: 0, gross: 0, amount: 0,
    ...over,
  }) as AkdTrade;

const statement = (over: Partial<AkdStatement> = {}): AkdStatement => ({
  account: { coaf: null, name: null, cdcId: null, fromDate: null, toDate: null },
  entries: [], trades: [], deposits: [], charges: [], inventory: [],
  controls: { totalDebit: null, totalCredit: null, ledgerBalance: null, inventoryValue: null, netWorth: null },
  warnings: [],
  ...over,
});

describe("isAkdStatement", () => {
  const good = "AKD SECURITIES LIMITED\nStatement Of Account\nDate Entry# Narration Debit Credit Balance\n";

  test("accepts a statement carrying all three markers", () => {
    expect(isAkdStatement(good)).toBe(true);
  });

  test("rejects text missing the broker name", () => {
    expect(isAkdStatement(good.replace("AKD SECURITIES LIMITED", "OTHER BROKER"))).toBe(false);
  });

  test("rejects a different AKD document with no ledger table", () => {
    expect(isAkdStatement("AKD SECURITIES LIMITED\nStatement Of Account\n")).toBe(false);
  });

  test("rejects an unrelated document", () => {
    expect(isAkdStatement("CDC Investor Account Services\nholdings report\n")).toBe(false);
  });
});

describe("reconcileAkd: cash", () => {
  test("balance is deposits plus sells less buys, tax and fees", () => {
    const r = reconcileAkd(statement({
      deposits: [entry({ kind: "DEPOSIT", amount: 500_000 })],
      trades: [
        trade({ ticker: "HBL", side: "BUY", quantity: 100, net: 120_000 }),
        trade({ ticker: "HBL", side: "SELL", quantity: 40, net: 60_000 }),
      ],
      charges: [entry({ kind: "CGT", amount: 1_500 }), entry({ kind: "FEE", amount: 500 })],
      controls: { totalDebit: null, totalCredit: null, ledgerBalance: 438_000, inventoryValue: null, netWorth: null },
    }));
    expect(r.cash.computedBalance).toBe(438_000);
    expect(r.cash.difference).toBe(0);
    expect(r.cash.matches).toBe(true);
  });

  test("a balance that disagrees with the statement is reported, not hidden", () => {
    const r = reconcileAkd(statement({
      deposits: [entry({ kind: "DEPOSIT", amount: 100_000 })],
      controls: { totalDebit: null, totalCredit: null, ledgerBalance: 99_000, inventoryValue: null, netWorth: null },
    }));
    expect(r.cash.difference).toBe(1_000);
    expect(r.cash.matches).toBe(false);
  });

  test("no stated balance means no claim either way", () => {
    const r = reconcileAkd(statement({ deposits: [entry({ kind: "DEPOSIT", amount: 100_000 })] }));
    expect(r.cash.statedBalance).toBeNull();
    expect(r.cash.difference).toBeNull();
  });
});

describe("reconcileAkd: holdings", () => {
  test("a rebuilt position that matches inventory reports no gap", () => {
    const r = reconcileAkd(statement({
      trades: [trade({ ticker: "HBL", side: "BUY", quantity: 100, net: 120_000 })],
      inventory: [{ ticker: "HBL", companyName: "Habib Bank", quantity: 100, closingRate: 130, amount: 13_000 }],
    }));
    expect(r.holdings[0]).toMatchObject({ ticker: "HBL", rebuiltQty: 100, statedQty: 100, difference: 0, note: null });
    expect(r.holdings[0].avgCost).toBe(1_200);
  });

  test("shares held but never bought are called out as likely bonus or spin-off", () => {
    const r = reconcileAkd(statement({
      inventory: [{ ticker: "MARI", companyName: null, quantity: 25, closingRate: 500, amount: 12_500 }],
    }));
    expect(r.holdings[0].note).toMatch(/bonus/i);
    expect(r.holdings[0].rebuiltQty).toBe(0);
  });

  test("a quantity gap is flagged rather than silently averaged away", () => {
    const r = reconcileAkd(statement({
      trades: [trade({ ticker: "HBL", side: "BUY", quantity: 100, net: 120_000 })],
      inventory: [{ ticker: "HBL", companyName: null, quantity: 125, closingRate: 130, amount: 16_250 }],
    }));
    expect(r.holdings[0].difference).toBe(-25);
    expect(r.holdings[0].note).toMatch(/gap|bonus/i);
  });

  test("positions closed to zero on both sides drop out of the report", () => {
    const r = reconcileAkd(statement({
      trades: [
        trade({ ticker: "HBL", side: "BUY", quantity: 100, net: 100_000, date: "2026-01-01" }),
        trade({ ticker: "HBL", side: "SELL", quantity: 100, net: 130_000, date: "2026-02-01" }),
      ],
    }));
    expect(r.holdings).toHaveLength(0);
    expect(r.totalRealizedPl).toBe(30_000);
  });
});

describe("reconcileAkd: realised results", () => {
  test("a sell realises proceeds less the average cost of the shares sold", () => {
    const r = reconcileAkd(statement({
      trades: [
        trade({ ticker: "HBL", side: "BUY", quantity: 100, net: 100_000, date: "2026-01-01" }),
        trade({ ticker: "HBL", side: "SELL", quantity: 40, net: 60_000, date: "2026-02-01" }),
      ],
    }));
    expect(r.realizedPl.find((x) => x.ticker === "HBL")?.amount).toBe(20_000);
  });

  test("trades are replayed in date order however the statement lists them", () => {
    const buy = trade({ ticker: "HBL", side: "BUY", quantity: 100, net: 100_000, date: "2026-01-01" });
    const sell = trade({ ticker: "HBL", side: "SELL", quantity: 50, net: 70_000, date: "2026-02-01" });
    expect(reconcileAkd(statement({ trades: [sell, buy] })).totalRealizedPl)
      .toBe(reconcileAkd(statement({ trades: [buy, sell] })).totalRealizedPl);
  });

  test("an empty statement reconciles to zero rather than throwing", () => {
    const r = reconcileAkd(statement());
    expect(r.totalRealizedPl).toBe(0);
    expect(r.holdings).toHaveLength(0);
    expect(r.cash.computedBalance).toBe(0);
  });
});
