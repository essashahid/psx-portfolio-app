import { growthReading, payoutReading, priceStructureReading, valuationReading } from "@/lib/company/readings";

const series = (values: number[], firstYear = 2022) => values.map((value, i) => ({ year: firstYear + i, value }));

describe("growthReading", () => {
  it("reads revenue against profit when both grew at the same pace", () => {
    // 100 -> 119.1 over three years is about 6% a year; EPS tracks it.
    const s = growthReading(series([100, 106, 112.4, 119.1]), series([10, 10.6, 11.2, 11.9]));
    expect(s).toBe("Revenue grew about 6% a year since FY2022 and profit kept pace.");
  });

  it("says when profit grew faster or lagged", () => {
    expect(growthReading(series([100, 106, 112.4, 119.1]), series([10, 12, 14.4, 17.3]))).toMatch(/profit grew faster, about 20% a year/);
    expect(growthReading(series([100, 110, 121, 133.1]), series([10, 10.2, 10.4, 10.6]))).toMatch(/profit lagged, about 2% a year/);
    expect(growthReading(series([100, 110, 121]), series([10, 8, 6.4]))).toMatch(/earnings per share fell about 20% a year/);
  });

  it("names a latest-year loss rather than computing a rate across it", () => {
    expect(growthReading(series([100, 110, 121]), series([10, 4, -2]))).toBe("Revenue grew about 10% a year since FY2022, but FY2024 was a loss.");
  });

  it("says so when there is not enough data", () => {
    expect(growthReading([], [])).toBe("Not enough filed years to read a trend.");
    expect(growthReading(series([100]), series([10]))).toBe("Not enough filed years to read a trend.");
    expect(growthReading(series([100]), series([-3]))).toMatch(/FY2022, was a loss\. Not enough filed years/);
    expect(growthReading(series([100]), series([10, 11]))).toMatch(/^Earnings per share grew about 10% a year since FY2022\. Revenue has too few/);
  });

  it("never emits a dash", () => {
    for (const s of [growthReading(series([100, 90]), series([5, -1])), growthReading([], [])]) expect(s).not.toMatch(/[—–]/);
  });
});

describe("payoutReading", () => {
  it("reads the payout, yield and share of earnings in one sentence", () => {
    expect(payoutReading({ ttmDps: 16, divYield: 5.2, payoutRatio: 60.4 })).toBe(
      "Paid PKR 16.00 per share over the last year, a 5.20% yield at today's price, about 60% of earnings."
    );
  });

  it("leaves the earnings share out when the payout ratio is unknown", () => {
    expect(payoutReading({ ttmDps: 16, divYield: 5.2, payoutRatio: null })).toBe(
      "Paid PKR 16.00 per share over the last year, a 5.20% yield at today's price."
    );
  });

  it("says there was no verified dividend", () => {
    expect(payoutReading({ ttmDps: null, divYield: null, payoutRatio: null })).toBe("No verified cash dividend in the last 12 months.");
  });
});

describe("valuationReading", () => {
  it("sets the multiple against the sector median", () => {
    expect(valuationReading({ pe: 12, sectorMedianPe: 15, peers: 9 })).toBe("Priced at 12.0x earnings, below the sector's 15.0x.");
    expect(valuationReading({ pe: 18, sectorMedianPe: 15, peers: 9 })).toBe("Priced at 18.0x earnings, above the sector's 15.0x.");
    expect(valuationReading({ pe: 15.5, sectorMedianPe: 15, peers: 9 })).toBe("Priced at 15.5x earnings, in line with the sector's 15.0x.");
  });

  it("says when there is no sector median", () => {
    expect(valuationReading({ pe: 12, sectorMedianPe: null, peers: 2 })).toBe(
      "Priced at 12.0x earnings. Only 2 peers priced, so there is no sector median to set it against."
    );
  });

  it("explains a withheld multiple by its cause", () => {
    expect(valuationReading({ pe: null, sectorMedianPe: 15, peers: 9, missing: "Loss-making period" })).toBe("No earnings multiple. The latest period was a loss.");
    expect(valuationReading({ pe: null, sectorMedianPe: 15, peers: 9, missing: "Contested: two readings disagree" })).toMatch(/under review/);
    expect(valuationReading({ pe: null, sectorMedianPe: 15, peers: 9, missing: null })).toBe("Not enough filed data to price it on earnings.");
  });
});

describe("priceStructureReading", () => {
  it("reads the price against the 50-session average and the 52-week high", () => {
    expect(priceStructureReading({ price: 82, ma50: 78, high52: 100, low52: 60 })).toBe(
      "Trading above its 50-session average, 18% below the 52-week high."
    );
    expect(priceStructureReading({ price: 70, ma50: 78, high52: 100, low52: 60 })).toBe(
      "Trading below its 50-session average, 30% below the 52-week high."
    );
  });

  it("names the extremes", () => {
    expect(priceStructureReading({ price: 100, ma50: 90, high52: 100, low52: 60 })).toBe("Trading above its 50-session average, at its 52-week high.");
    expect(priceStructureReading({ price: 60, ma50: null, high52: 100, low52: 60 })).toBe("Trading at its 52-week low.");
  });

  it("says so when there is not enough data", () => {
    expect(priceStructureReading({ price: null, ma50: 78, high52: 100, low52: 60 })).toMatch(/No recent price/);
    expect(priceStructureReading({ price: 80, ma50: null, high52: null, low52: null })).toBe("Not enough price history to read the structure yet.");
  });
});
