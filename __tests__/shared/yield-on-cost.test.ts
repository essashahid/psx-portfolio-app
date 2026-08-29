import { buildYieldOnCost } from "@psx/shared/dividends/yield-on-cost";

const holding = (ticker: string, totalCost: number, marketValue: number | null) => ({
  ticker,
  companyName: null,
  totalCost,
  marketValue,
});
const paid = (ticker: string, date: string, net: number, status = "received") => ({
  ticker,
  status,
  date,
  net,
});

describe("buildYieldOnCost", () => {
  it("measures the payout against what you paid, and against what it is worth", () => {
    // Bought for 100k, now worth 200k, paid 8k in the year: 8% on cost, 4% on
    // value. An old position diverges like this, which is the whole point.
    const rows = buildYieldOnCost(
      [holding("OGDC", 100_000, 200_000)],
      [paid("OGDC", "2026-03-01", 8_000)],
      "2026-08-29"
    );
    expect(rows[0].yieldOnCost).toBeCloseTo(8);
    expect(rows[0].yieldOnValue).toBeCloseTo(4);
  });

  it("counts only cash actually received", () => {
    const rows = buildYieldOnCost(
      [holding("MEBL", 50_000, 60_000)],
      [paid("MEBL", "2026-06-01", 5_000, "announced")],
      "2026-08-29"
    );
    expect(rows).toHaveLength(0);
  });

  it("ignores payments older than a year", () => {
    const rows = buildYieldOnCost(
      [holding("LUCK", 10_000, 12_000)],
      [paid("LUCK", "2024-01-01", 900)],
      "2026-08-29"
    );
    expect(rows).toHaveLength(0);
  });

  it("drops a holding that paid nothing rather than showing it at zero", () => {
    const rows = buildYieldOnCost([holding("SYS", 60_000, 70_000)], [], "2026-08-29");
    expect(rows).toHaveLength(0);
  });

  it("ranks by yield on cost", () => {
    const rows = buildYieldOnCost(
      [holding("A", 100_000, null), holding("B", 100_000, null)],
      [paid("A", "2026-05-01", 2_000), paid("B", "2026-05-01", 9_000)],
      "2026-08-29"
    );
    expect(rows.map((r) => r.ticker)).toEqual(["B", "A"]);
  });

  it("leaves the yield null when there is no cost basis to divide by", () => {
    const rows = buildYieldOnCost(
      [holding("GIFT", 0, 5_000)],
      [paid("GIFT", "2026-05-01", 500)],
      "2026-08-29"
    );
    expect(rows[0].yieldOnCost).toBeNull();
    expect(rows[0].yieldOnValue).toBeCloseTo(10);
  });
});
