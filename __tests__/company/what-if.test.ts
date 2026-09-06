import { computeWhatIf, dateYearsAgo } from "../../lib/company/what-if";

/** A flat series that doubles over two years, oldest first. */
function series(start: string, days: number, from: number, to: number) {
  const out = [];
  const t0 = Date.parse(start);
  for (let i = 0; i < days; i++) {
    const d = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, close: from + ((to - from) * i) / (days - 1) });
  }
  return out;
}

const base = { ticker: "T", amount: 100_000, payoutsKnownFrom: "2024-01-01", payouts: [], benchmark: null };

describe("computeWhatIf", () => {
  test("price-only doubling over two years is a 100% total return and about 41% a year", () => {
    const r = computeWhatIf({ ...base, from: "2024-01-01", candles: series("2024-01-01", 731, 100, 200) });
    if ("error" in r) throw new Error(r.error);
    expect(r.sharesAtStart).toBe(1000);
    expect(r.valueNow).toBe(200_000);
    expect(r.totalReturnPct).toBe(100);
    expect(r.annualisedPct).toBeGreaterThan(40);
    expect(r.annualisedPct).toBeLessThan(42);
    expect(r.dividendsIncomplete).toBe(false);
  });

  test("the start snaps forward to the first trading day on or after the date", () => {
    const candles = series("2024-01-01", 400, 100, 100).filter((c) => c.date !== "2024-01-06");
    const r = computeWhatIf({ ...base, from: "2024-01-06", candles });
    if ("error" in r) throw new Error(r.error);
    expect(r.startDate).toBe("2024-01-07");
  });

  test("dividends pay on shares held and are counted only inside the window", () => {
    const r = computeWhatIf({
      ...base,
      from: "2024-01-01",
      candles: series("2024-01-01", 400, 100, 100),
      payouts: [
        { date: "2023-12-01", dps: 5 },
        { date: "2024-06-01", dps: 5 },
        { date: "2024-12-01", dps: 5 },
      ],
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.dividendCount).toBe(2);
    expect(r.dividends).toBe(10_000);
    expect(r.total).toBe(110_000);
  });

  test("a bonus issue keeps the position whole and pays later dividends on the larger share count", () => {
    // 100 flat, then a 1:1 bonus halves the price to 50, flat after.
    const candles = [...series("2024-01-01", 200, 100, 100), ...series("2024-07-19", 200, 50, 50)];
    const r = computeWhatIf({ ...base, from: "2024-01-01", candles, payouts: [{ date: "2024-10-01", dps: 2 }] });
    if ("error" in r) throw new Error(r.error);
    expect(r.bonusEvents).toBe(1);
    expect(r.sharesNow).toBe(2000);
    expect(r.valueNow).toBe(100_000);
    expect(r.dividends).toBe(4000);
  });

  test("a start before the payout record is flagged incomplete, not padded", () => {
    const r = computeWhatIf({ ...base, from: "2024-01-01", candles: series("2024-01-01", 400, 100, 100), payoutsKnownFrom: "2024-06-01" });
    if ("error" in r) throw new Error(r.error);
    expect(r.dividendsIncomplete).toBe(true);
    expect(r.dividends).toBe(0);
  });

  test("the benchmark is measured over the same window", () => {
    const r = computeWhatIf({
      ...base,
      from: "2024-01-01",
      candles: series("2024-01-01", 400, 100, 150),
      benchmark: { label: "KSE-100", candles: series("2024-01-01", 400, 1000, 1200) },
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.benchmark).toEqual({ label: "KSE-100", valueNow: 120_000, returnPct: 20 });
  });

  test("bad inputs are errors, not numbers", () => {
    expect(computeWhatIf({ ...base, from: "2024-01-01", candles: [] })).toEqual({ error: "Not enough price history for this company." });
    expect(computeWhatIf({ ...base, amount: 0, from: "2024-01-01", candles: series("2024-01-01", 10, 1, 2) })).toEqual({ error: "Enter an amount above zero." });
    expect(computeWhatIf({ ...base, from: "2030-01-01", candles: series("2024-01-01", 10, 1, 2) })).toEqual({ error: "Pick a date before the latest close." });
  });

  test("dateYearsAgo subtracts whole years", () => {
    expect(dateYearsAgo(3, new Date("2026-09-07T00:00:00Z"))).toBe("2023-09-07");
  });
});
