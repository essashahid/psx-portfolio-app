import { buildReturnDistribution } from "@psx/shared/market/return-distribution";

const change = (ticker: string, pct: number) => ({ ticker, pct });

describe("buildReturnDistribution", () => {
  it("buckets by whole percent and marks the caller's own tickers", () => {
    const d = buildReturnDistribution(
      [change("OGDC", 2.4), change("MEBL", 2.9), change("LUCK", -1.2)],
      ["OGDC"]
    );
    const up2 = d.buckets.find((b) => b.lo === 2)!;
    expect(up2.count).toBe(2);
    expect(up2.mine).toEqual(["OGDC"]);
    expect(d.buckets.find((b) => b.lo === -2)!.count).toBe(1);
    expect(d.total).toBe(3);
  });

  it("clamps the tails rather than dropping them", () => {
    // A company down 11% belongs in the leftmost bar, not missing from the
    // count of how many fell.
    const d = buildReturnDistribution([change("X", -11), change("Y", 14)], []);
    expect(d.buckets[0].count).toBe(1);
    expect(d.buckets[d.buckets.length - 1].count).toBe(1);
    expect(d.total).toBe(2);
  });

  it("reports the strongest and weakest", () => {
    const d = buildReturnDistribution([change("A", -3), change("B", 5), change("C", 1)], []);
    expect(d.best).toEqual({ ticker: "B", pct: 5 });
    expect(d.worst).toEqual({ ticker: "A", pct: -3 });
  });

  it("survives an empty market", () => {
    const d = buildReturnDistribution([], ["OGDC"]);
    expect(d.total).toBe(0);
    expect(d.best).toBeNull();
    expect(d.buckets).toHaveLength(12);
  });

  it("ignores a non-numeric change rather than bucketing it at zero", () => {
    const d = buildReturnDistribution([change("A", Number.NaN), change("B", 1)], []);
    expect(d.total).toBe(1);
  });
});
