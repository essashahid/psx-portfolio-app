import { buildForecastDataset, runWalkForward, directionClass, SIDEWAYS_BAND, DIR_FALL, DIR_RISE, DIR_SIDE } from "@/lib/engine/outlook/walkforward";
import { directionMetrics, rangeMetrics, ddMetrics, episodeClusters, gateDrawdown, splitBy } from "@/lib/engine/outlook/forecast-metrics";
import type { AlignedInputs } from "@/lib/engine/outlook/inputs";
import type { DdPrediction, DirPrediction, RangePrediction } from "@/lib/engine/outlook/walkforward";

/**
 * The one property the whole of Phase 3 rests on: a walk-forward prediction
 * for a date must be identical whether or not the data after it exists. If it
 * is, then purging, standardisation and every model fit are using only what
 * was knowable at that date.
 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function syntheticInputs(sessions: number, seed = 9): AlignedInputs {
  const rand = lcg(seed);
  const dates: string[] = [];
  const d = new Date(Date.UTC(2021, 0, 4));
  while (dates.length < sessions) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  let close = 40000;
  const kse100 = dates.map(() => (close *= 1 + (rand() - 0.49) * 0.018));
  return {
    dates,
    kse100,
    kse100Volume: kse100.map(() => 1e6 + rand() * 1e5),
    allshr: kse100.map((v) => v * 0.6),
    kse30: kse100.map((v) => v * 0.3),
    kmi30: kse100.map((v) => v * 1.4),
    breadth: {
      advanceShare: dates.map((_, i) => (i < 5 ? null : rand())),
      pctAboveMa200: dates.map(() => rand()),
      newLowsShare: dates.map(() => rand() * 0.05),
      dispersion: dates.map(() => 0.01 + rand() * 0.03),
      upVolumeShare: dates.map((_, i) => (i < 5 ? null : rand())),
    },
    fipiNet: dates.map(() => (rand() - 0.5) * 8),
    usdPkr: dates.map((_, i) => (i === 0 ? null : 280 + i * 0.01)),
    goldUsd: dates.map((_, i) => (i === 0 ? null : 2000 + rand() * 20)),
    spy: dates.map((_, i) => (i === 0 ? null : 500 + rand() * 10)),
    eem: dates.map((_, i) => (i === 0 ? null : 60 + rand())),
    brent: dates.map((_, i) => (i === 0 ? null : 70 + rand() * 5)),
    policyRate: dates.map(() => 12),
    cpiYoY: dates.map(() => 10),
  };
}

function truncateInputs(inputs: AlignedInputs, k: number): AlignedInputs {
  const cut = <T,>(a: T[]): T[] => a.slice(0, k);
  return {
    ...inputs,
    dates: cut(inputs.dates),
    kse100: cut(inputs.kse100),
    kse100Volume: cut(inputs.kse100Volume),
    allshr: cut(inputs.allshr),
    kse30: cut(inputs.kse30),
    kmi30: cut(inputs.kmi30),
    breadth: {
      advanceShare: cut(inputs.breadth.advanceShare),
      pctAboveMa200: cut(inputs.breadth.pctAboveMa200),
      newLowsShare: cut(inputs.breadth.newLowsShare),
      dispersion: cut(inputs.breadth.dispersion),
      upVolumeShare: cut(inputs.breadth.upVolumeShare),
    },
    fipiNet: cut(inputs.fipiNet),
    usdPkr: cut(inputs.usdPkr),
    goldUsd: cut(inputs.goldUsd),
    spy: cut(inputs.spy),
    eem: cut(inputs.eem),
    brent: cut(inputs.brent),
    policyRate: cut(inputs.policyRate),
    cpiYoY: cut(inputs.cpiYoY),
  };
}

describe("directionClass", () => {
  it("maps returns to classes by the documented bands", () => {
    expect(directionClass(-0.02, SIDEWAYS_BAND[5])).toBe(DIR_FALL);
    expect(directionClass(0.005, SIDEWAYS_BAND[5])).toBe(DIR_SIDE);
    expect(directionClass(0.02, SIDEWAYS_BAND[5])).toBe(DIR_RISE);
  });
});

describe("runWalkForward", () => {
  const inputs = syntheticInputs(950);
  const run = runWalkForward(buildForecastDataset(inputs));

  it("produces folds and predictions strictly after each training boundary", () => {
    expect(run.folds.length).toBeGreaterThan(3);
    const boundaryByFold = new Map(run.folds.map((f) => [f.fold, f.trainEnd]));
    for (const p of [...run.direction, ...run.returns, ...run.ranges, ...run.drawdowns]) {
      expect(p.index).toBeGreaterThan(boundaryByFold.get(p.fold)!);
    }
  });

  it("is prefix-consistent: truncating the future changes no earlier prediction", () => {
    // Truncate to 560 sessions; predictions with index + 20 < 560 must match.
    const shorter = runWalkForward(buildForecastDataset(truncateInputs(inputs, 830)));
    const key = (p: { date: string; horizon: number; model: string }) => `${p.date}|${p.horizon}|${p.model}`;
    const fullDd = new Map(run.drawdowns.filter((p) => p.index + 20 < 830).map((p) => [key(p) + p.threshold, p.p]));
    let compared = 0;
    for (const p of shorter.drawdowns) {
      const match = fullDd.get(key(p) + p.threshold);
      if (match !== undefined) {
        expect(p.p).toBeCloseTo(match, 10);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(50);

    const fullDir = new Map(run.direction.filter((p) => p.index + 20 < 830).map((p) => [key(p), p.probs.join(",")]));
    for (const p of shorter.direction) {
      const match = fullDir.get(key(p));
      if (match !== undefined) expect(p.probs.join(",")).toBe(match);
    }
  });

  it("includes every entrant for every task", () => {
    const models = (list: { model: string }[]) => new Set(list.map((p) => p.model));
    expect(models(run.direction)).toEqual(new Set(["base-rate", "always-up", "trend-naive", "logit-vol", "logit-vol-breadth", "robust-plus-momentum", "analog"]));
    expect(models(run.returns)).toEqual(new Set(["zero", "train-mean", "ridge-vol-breadth", "analog-median"]));
    expect(models(run.ranges)).toEqual(new Set(["empirical", "vol-scaled", "quantile-reg"]));
    expect(models(run.drawdowns)).toEqual(new Set(["base-rate", "logit-vol", "logit-vol-breadth", "stumps", "vol-scaled-cdf"]));
  });
});

describe("metrics", () => {
  it("computes a confusion matrix and balanced accuracy", () => {
    const preds: DirPrediction[] = [
      { date: "2024-01-01", index: 1, fold: 0, horizon: 5, model: "m", probs: [0.6, 0.2, 0.2], predicted: 0, actual: 0, actualReturn: -0.02 },
      { date: "2024-01-02", index: 2, fold: 0, horizon: 5, model: "m", probs: [0.2, 0.2, 0.6], predicted: 2, actual: 0, actualReturn: -0.02 },
      { date: "2024-01-03", index: 3, fold: 0, horizon: 5, model: "m", probs: [0.1, 0.2, 0.7], predicted: 2, actual: 2, actualReturn: 0.02 },
      { date: "2024-01-04", index: 4, fold: 0, horizon: 5, model: "m", probs: [0.1, 0.7, 0.2], predicted: 1, actual: 1, actualReturn: 0 },
    ];
    const m = directionMetrics(preds);
    expect(m.accuracy).toBeCloseTo(0.75);
    expect(m.confusion[0][2]).toBe(1);
    expect(m.balancedAccuracy).toBeCloseTo((0.5 + 1 + 1) / 3);
  });

  it("scores range coverage and interval width", () => {
    const preds: RangePrediction[] = [
      { date: "a", index: 1, fold: 0, horizon: 5, model: "m", closeLo: -0.02, closeHi: 0.02, pathLo: -0.03, pathHi: 0.03, actualReturn: 0.01, actualMin: -0.01, actualMax: 0.02 },
      { date: "b", index: 2, fold: 0, horizon: 5, model: "m", closeLo: -0.02, closeHi: 0.02, pathLo: -0.03, pathHi: 0.03, actualReturn: 0.05, actualMin: -0.01, actualMax: 0.06 },
    ];
    const m = rangeMetrics(preds);
    expect(m.closeCoverage).toBeCloseTo(0.5);
    expect(m.pathCoverage).toBeCloseTo(0.5);
    expect(m.avgCloseWidth).toBeCloseTo(0.04);
    expect(m.intervalScore).toBeGreaterThan(0.04); // violation penalised
  });

  it("clusters episodes and scores drawdown skill against the base entrant", () => {
    const mk = (date: string, p: number, hit: boolean, model = "m"): DdPrediction => ({
      date,
      index: 0,
      fold: 0,
      horizon: 10,
      model,
      threshold: -0.03,
      p,
      hit,
    });
    // Candidate assigns high p to hits, base assigns flat 0.2.
    const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-03-01", "2024-03-04", "2024-06-01"];
    const hits = [true, true, true, false, false, true];
    const cand = dates.map((d, i) => mk(d, hits[i] ? 0.7 : 0.1, hits[i]));
    const base = dates.map((d, i) => mk(d, 0.2, hits[i], "base"));
    const m = ddMetrics(cand, base, 10);
    expect(m.brierSkill).toBeGreaterThan(0);
    expect(m.hitEpisodes).toBe(2); // Jan cluster + June single
    expect(m.detectedEpisodes).toBe(2);
    expect(episodeClusters(dates.filter((_, i) => hits[i]), 10).length).toBe(2);
  });

  it("gates drawdown on halves and episode dependence", () => {
    const mk = (date: string, p: number, hit: boolean, model = "m"): DdPrediction => ({
      date, index: 0, fold: 0, horizon: 10, model, threshold: -0.03, p, hit,
    });
    const dates = Array.from({ length: 200 }, (_, i) => {
      const d = new Date(Date.UTC(2023, 0, 2));
      d.setUTCDate(d.getUTCDate() + i * 3);
      return d.toISOString().slice(0, 10);
    });
    // Hits scattered through BOTH halves, candidate sees them coming.
    const hits = dates.map((_, i) => i % 17 === 0);
    const cand = dates.map((d, i) => mk(d, hits[i] ? 0.6 : 0.08, hits[i]));
    const base = dates.map((d, i) => mk(d, 0.12, hits[i], "base"));
    const split = splitBy(cand, (list) => ddMetrics(list, base, 10));
    const gate = gateDrawdown(split);
    expect(gate.pass).toBe(true);

    // A candidate whose skill lives in one episode must fail.
    const oneEpisode = dates.map((d, i) => mk(d, i < 3 && hits[i] ? 0.9 : 0.12, hits[i]));
    const splitBad = splitBy(oneEpisode, (list) => ddMetrics(list, base, 10));
    expect(gateDrawdown(splitBad).pass).toBe(false);
  });
});
