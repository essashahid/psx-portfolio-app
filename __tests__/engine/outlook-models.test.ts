import {
  fitRidge,
  predictRidge,
  fitLogistic,
  predictLogistic,
  fitMultinomial,
  predictMultinomial,
  fitQuantile,
  predictQuantile,
  fitVolScaled,
  volScaledQuantile,
  volScaledCdf,
  fitStumps,
  predictStumps,
  solveLinear,
  quantileOf,
} from "@/lib/engine/outlook/models";
import { findSwings, levelsAt, rsiAt, ewmaVolAt, technicalStructureAt, type Bar } from "@/lib/engine/outlook/technical-structure";

/** Deterministic pseudo-random source. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("solveLinear", () => {
  it("solves a known system", () => {
    const x = solveLinear(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10]
    );
    expect(x[0]).toBeCloseTo(1, 8);
    expect(x[1]).toBeCloseTo(3, 8);
  });
});

describe("ridge regression", () => {
  it("recovers a linear relationship", () => {
    const rand = lcg(1);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = rand() * 2 - 1;
      const b = rand() * 2 - 1;
      X.push([a, b]);
      y.push(3 * a - 2 * b + 0.5 + (rand() - 0.5) * 0.01);
    }
    const m = fitRidge(X, y, 0.01);
    expect(predictRidge(m, [0.5, -0.5])).toBeCloseTo(3 * 0.5 - 2 * -0.5 + 0.5, 1);
  });
});

describe("logistic", () => {
  it("orders probabilities by the separating feature", () => {
    const rand = lcg(2);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 600; i++) {
      const v = rand();
      X.push([v]);
      y.push(rand() < v ? 1 : 0); // higher feature, higher hit rate
    }
    const m = fitLogistic(X, y);
    expect(predictLogistic(m, [0.9])).toBeGreaterThan(predictLogistic(m, [0.1]));
    expect(predictLogistic(m, [0.5])).toBeGreaterThan(0.2);
    expect(predictLogistic(m, [0.5])).toBeLessThan(0.8);
  });
});

describe("multinomial", () => {
  it("produces a probability simplex and learns class structure", () => {
    const rand = lcg(3);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 900; i++) {
      const v = rand();
      X.push([v]);
      y.push(v < 0.33 ? 0 : v < 0.66 ? 1 : 2);
    }
    const m = fitMultinomial(X, y);
    const low = predictMultinomial(m, [0.05]);
    const high = predictMultinomial(m, [0.95]);
    expect(low.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(low[0]).toBeGreaterThan(low[2]);
    expect(high[2]).toBeGreaterThan(high[0]);
  });
});

describe("quantile model", () => {
  it("keeps quantiles ordered and near their unconditional targets on iid data", () => {
    const rand = lcg(4);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 800; i++) {
      X.push([rand()]);
      y.push((rand() + rand() + rand() - 1.5) * 0.02); // roughly symmetric around 0
    }
    const q10 = fitQuantile(X, y, 0.1);
    const q90 = fitQuantile(X, y, 0.9);
    const lo = predictQuantile(q10, [0.5]);
    const hi = predictQuantile(q90, [0.5]);
    expect(lo).toBeLessThan(hi);
    const sorted = [...y].sort((a, b) => a - b);
    expect(Math.abs(lo - quantileOf(sorted, 0.1))).toBeLessThan(0.01);
    expect(Math.abs(hi - quantileOf(sorted, 0.9))).toBeLessThan(0.01);
  });
});

describe("vol-scaled distribution", () => {
  it("scales quantiles with current volatility and inverts through its CDF", () => {
    const outcomes = Array.from({ length: 500 }, (_, i) => (i / 499 - 0.5) * 0.1); // uniform-ish
    const scale = outcomes.map(() => 0.02);
    const d = fitVolScaled(outcomes, scale);
    const qLow = volScaledQuantile(d, 0.1, 0.02);
    const qDouble = volScaledQuantile(d, 0.1, 0.04);
    expect(qDouble).toBeCloseTo(qLow * 2, 8);
    const p = volScaledCdf(d, qLow, 0.02);
    expect(p).toBeGreaterThan(0.05);
    expect(p).toBeLessThan(0.15);
  });
});

describe("boosted stumps", () => {
  it("separates an obvious threshold pattern", () => {
    const rand = lcg(5);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 600; i++) {
      const v = rand();
      X.push([v, rand()]);
      y.push(v > 0.7 ? 1 : 0);
    }
    const m = fitStumps(X, y);
    expect(predictStumps(m, [0.9, 0.5])).toBeGreaterThan(predictStumps(m, [0.1, 0.5]) + 0.2);
  });
});

// --- Technical structure -------------------------------------------------------

function barsFrom(closes: number[]): Bar[] {
  const base = new Date(Date.UTC(2022, 0, 3));
  return closes.map((close, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + Math.floor(i / 5) * 7 + (i % 5));
    return { date: d.toISOString().slice(0, 10), close, volume: 1000 };
  });
}

describe("technical structure", () => {
  it("finds fractal swings on a zigzag", () => {
    // Rise to a peak at index 10, fall to a trough at 20, rise again.
    const closes = Array.from({ length: 31 }, (_, i) => 100 + 10 * Math.cos(((i - 10) / 10) * Math.PI) * (i <= 20 ? 1 : -1));
    const swings = findSwings(barsFrom(closes), 3);
    expect(swings.some((s) => s.kind === "high" && Math.abs(s.index - 10) <= 1)).toBe(true);
    expect(swings.some((s) => s.kind === "low" && Math.abs(s.index - 20) <= 1)).toBe(true);
  });

  it("only uses swings confirmed by the as-of date", () => {
    // A V-bottom right at the end: the trough is not yet confirmed (needs K
    // sessions after it), so it must not appear as a support level.
    const closes = [...Array.from({ length: 300 }, (_, i) => 100 + i * 0.1), 95, 94, 93];
    const bars = barsFrom(closes);
    const { supports } = levelsAt(bars, bars.length - 1);
    expect(supports.every((s) => Math.abs(s.price / 93 - 1) > 0.001 || s.source !== "swing-cluster")).toBe(true);
  });

  it("keeps at most three levels per side and none duplicated within tolerance", () => {
    const rand = lcg(6);
    let c = 40000;
    const closes = Array.from({ length: 500 }, () => (c *= 1 + (rand() - 0.5) * 0.03));
    const bars = barsFrom(closes);
    const { supports, resistances } = levelsAt(bars, bars.length - 1);
    expect(supports.length).toBeLessThanOrEqual(3);
    expect(resistances.length).toBeLessThanOrEqual(3);
    const all = [...supports, ...resistances].map((l) => l.price).sort((a, b) => a - b);
    for (let i = 1; i < all.length; i++) {
      expect(all[i] / all[i - 1] - 1).toBeGreaterThan(0.005);
    }
  });

  it("reads RSI extremes correctly", () => {
    const rising = barsFrom(Array.from({ length: 40 }, (_, i) => 100 + i));
    const falling = barsFrom(Array.from({ length: 40 }, (_, i) => 140 - i));
    expect(rsiAt(rising, 39)!).toBeGreaterThan(90);
    expect(rsiAt(falling, 39)!).toBeLessThan(10);
  });

  it("scales expected movement with the square root of the horizon", () => {
    const rand = lcg(7);
    let c = 40000;
    const closes = Array.from({ length: 400 }, () => (c *= 1 + (rand() - 0.5) * 0.02));
    const bars = barsFrom(closes);
    const s = technicalStructureAt(bars, bars.length - 1)!;
    const em5 = s.expectedMove.find((e) => e.sessions === 5)!.fraction;
    const em20 = s.expectedMove.find((e) => e.sessions === 20)!.fraction;
    expect(em20 / em5).toBeCloseTo(2, 5);
    expect(ewmaVolAt(bars, bars.length - 1)!).toBeGreaterThan(0);
  });
});
