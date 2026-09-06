import {
  adjustForCorporateActions,
  detectCorporateActionBreaks,
} from "@psx/shared/market/adjust";

const candle = (close: number, extra: Partial<{ open: number; high: number; low: number; volume: number }> = {}) => ({
  date: "2024-01-01",
  close,
  volume: 1000,
  ...extra,
});

describe("detectCorporateActionBreaks", () => {
  it("finds nothing in a smooth series", () => {
    const series = [100, 101, 99.5, 102, 104, 103].map((c) => candle(c));
    expect(detectCorporateActionBreaks(series)).toEqual([]);
  });

  it("flags the Mari-style single-session collapse", () => {
    const series = [3520, 3536.83, 415.9, 420.1].map((c) => candle(c));
    const breaks = detectCorporateActionBreaks(series);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].index).toBe(2);
    expect(breaks[0].ratio).toBeCloseTo(415.9 / 3536.83, 6);
  });

  it("skips pairs with a missing or zero close", () => {
    const series = [100, 0, 105].map((c) => candle(c));
    expect(detectCorporateActionBreaks(series)).toEqual([]);
  });

  it("returns nothing for empty and single-element input", () => {
    expect(detectCorporateActionBreaks([])).toEqual([]);
    expect(detectCorporateActionBreaks([candle(100)])).toEqual([]);
  });
});

describe("adjustForCorporateActions", () => {
  it("is a no-op on a smooth series and returns a new array", () => {
    const series = [100, 101, 99.5, 102, 104, 103].map((c) => candle(c));
    const out = adjustForCorporateActions(series);
    expect(out).not.toBe(series);
    expect(out.map((c) => c.close)).toEqual(series.map((c) => c.close));
  });

  it("scales everything before a Mari-style break and leaves the latest close alone", () => {
    const series = [3520, 3536.83, 415.9, 420.1].map((c) => candle(c));
    const out = adjustForCorporateActions(series);
    const ratio = 415.9 / 3536.83;
    expect(out[0].close).toBeCloseTo(3520 * ratio, 6);
    expect(out[1].close).toBeCloseTo(415.9, 6);
    expect(out[2].close).toBe(415.9);
    expect(out[3].close).toBe(420.1);
    // The input is not mutated.
    expect(series[0].close).toBe(3520);
  });

  it("compounds two breaks", () => {
    // A 1:2 split, then later a 1:4 split. The oldest close is restated in
    // today's share terms, so it is divided by eight.
    const series = [800, 810, 405, 410, 102.5, 103].map((c) => candle(c));
    const out = adjustForCorporateActions(series);
    const later = 102.5 / 410;
    const earlier = 405 / 810;
    expect(out[5].close).toBe(103);
    expect(out[4].close).toBe(102.5);
    expect(out[3].close).toBeCloseTo(410 * later, 6);
    expect(out[2].close).toBeCloseTo(405 * later, 6);
    expect(out[1].close).toBeCloseTo(810 * later * earlier, 6);
    expect(out[0].close).toBeCloseTo(800 * later * earlier, 6);
    expect(out[0].close).toBeCloseTo(100, 6);
  });

  it("leaves a genuine 10% move untouched", () => {
    const series = [100, 110, 99, 108.9].map((c) => candle(c));
    const out = adjustForCorporateActions(series);
    expect(out.map((c) => c.close)).toEqual([100, 110, 99, 108.9]);
    expect(detectCorporateActionBreaks(series)).toEqual([]);
  });

  it("scales open, high and low alongside close and leaves volume alone", () => {
    const series = [
      candle(1000, { open: 990, high: 1010, low: 980, volume: 500 }),
      candle(250, { open: 248, high: 255, low: 245, volume: 900 }),
    ];
    const out = adjustForCorporateActions(series);
    expect(out[0].open).toBeCloseTo(990 * 0.25, 6);
    expect(out[0].high).toBeCloseTo(1010 * 0.25, 6);
    expect(out[0].low).toBeCloseTo(980 * 0.25, 6);
    expect(out[0].close).toBeCloseTo(250, 6);
    expect(out[0].volume).toBe(500);
    expect(out[1]).toEqual(series[1]);
  });

  it("copes with null open/high/low on the candle", () => {
    const series = [
      { close: 1000, open: null, high: null, low: null },
      { close: 250, open: null, high: null, low: null },
    ];
    const out = adjustForCorporateActions(series);
    expect(out[0].close).toBeCloseTo(250, 6);
    expect(out[0].open).toBeNull();
  });

  it("handles empty and single-element input", () => {
    expect(adjustForCorporateActions([])).toEqual([]);
    const one = [candle(100)];
    const out = adjustForCorporateActions(one);
    expect(out).toEqual(one);
    expect(out).not.toBe(one);
  });
});
