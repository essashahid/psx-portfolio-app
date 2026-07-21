import { buildSignalEvidence, forwardWorst, pitTercileStates, EVAL_HORIZONS, EVAL_THRESHOLDS, STATE_WARMUP } from "@/lib/engine/outlook/evaluate";
import { SIGNALS, BENCHMARK_SIGNAL_KEY } from "@/lib/engine/outlook/signals";
import type { AlignedInputs } from "@/lib/engine/outlook/inputs";

/**
 * The evaluation's whole claim is point-in-time honesty: nothing a date is
 * judged by may depend on data after that date. The prefix-consistency tests
 * are the enforcement: computing on a truncated history must reproduce the
 * full-history values exactly for every date inside the truncation.
 */

/** Deterministic pseudo-random source, so failures reproduce. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Synthetic aligned inputs: a seeded walk plus derived series with nulls. */
function syntheticInputs(sessions: number, seed = 7): AlignedInputs {
  const rand = lcg(seed);
  const dates: string[] = [];
  const d = new Date(Date.UTC(2021, 0, 4));
  while (dates.length < sessions) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  let close = 40000;
  const kse100 = dates.map(() => {
    close *= 1 + (rand() - 0.48) * 0.02;
    return close;
  });
  const derived = (scale: number, missEvery: number): (number | null)[] =>
    kse100.map((v, i) => (i % missEvery === 0 ? null : v * scale * (1 + (rand() - 0.5) * 0.01)));

  return {
    dates,
    kse100,
    kse100Volume: kse100.map(() => 1_000_000 + rand() * 500_000),
    allshr: derived(0.6, 97),
    kse30: derived(0.3, 89),
    kmi30: derived(1.4, 83),
    breadth: {
      advanceShare: dates.map((_, i) => (i < 10 ? null : rand())),
      pctAboveMa200: dates.map((_, i) => (i < 250 ? null : rand())),
      newLowsShare: dates.map((_, i) => (i < 250 ? null : rand() * 0.1)),
      dispersion: dates.map((_, i) => (i < 10 ? null : 0.01 + rand() * 0.04)),
      upVolumeShare: dates.map((_, i) => (i < 10 ? null : rand())),
    },
    fipiNet: dates.map((_, i) => (i === 0 || i % 61 === 0 ? null : (rand() - 0.5) * 10)),
    usdPkr: dates.map((_, i) => (i === 0 ? null : 280 + i * 0.01 + rand())),
    goldUsd: dates.map((_, i) => (i === 0 ? null : 2000 + i * 0.1 + rand() * 10)),
    spy: dates.map((_, i) => (i === 0 ? null : 500 + i * 0.05 + rand() * 5)),
    eem: dates.map((_, i) => (i === 0 ? null : 60 + rand())),
    brent: dates.map((_, i) => (i === 0 ? null : 70 + rand() * 5)),
    policyRate: dates.map((_, i) => (i < sessions / 2 ? 22 : 11)),
    cpiYoY: dates.map((_, i) => (i < 300 ? null : 10 + rand() * 20)),
  };
}

function truncate(inputs: AlignedInputs, k: number): AlignedInputs {
  const cut = <T>(a: T[]): T[] => a.slice(0, k);
  return {
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

describe("pitTercileStates", () => {
  it("assigns no state before the warmup", () => {
    const values = Array.from({ length: 300 }, (_, i) => i);
    const states = pitTercileStates(values, "high");
    expect(states.slice(0, STATE_WARMUP - 1).every((s) => s === null)).toBe(true);
    expect(states[STATE_WARMUP - 1]).not.toBeNull();
  });

  it("is prefix-consistent: adding future data never changes a past state", () => {
    const rand = lcg(11);
    const values = Array.from({ length: 600 }, () => rand());
    const full = pitTercileStates(values, "high");
    const prefix = pitTercileStates(values.slice(0, 400), "high");
    expect(full.slice(0, 400)).toEqual(prefix);
  });

  it("maps the hypothesised tail to risky for both directions", () => {
    // Monotone rising series: the latest value is always in its own top tail.
    const values = Array.from({ length: 300 }, (_, i) => i);
    expect(pitTercileStates(values, "high")[299]).toBe("risky");
    expect(pitTercileStates(values, "low")[299]).toBe("safe");
  });
});

describe("forwardWorst", () => {
  it("measures the worst point inside the window, not the endpoint", () => {
    // Dip to 90 then recover to 104: endpoint is +4%, worst is -10%.
    const closes = [100, 90, 104, 105, 106, 107];
    const worst = forwardWorst(closes, 3)[0];
    expect(worst).toBeCloseTo(-0.1);
  });

  it("returns null where the window runs off the end", () => {
    const closes = [100, 101, 102];
    expect(forwardWorst(closes, 5)).toEqual([null, null, null]);
  });
});

describe("signal library leakage", () => {
  const inputs = syntheticInputs(700);
  const truncated = truncate(inputs, 450);

  for (const def of SIGNALS) {
    it(`${def.key} is unchanged by future data`, () => {
      const full = def.compute(inputs).slice(0, 450);
      const prefix = def.compute(truncated);
      expect(full.length).toBe(prefix.length);
      for (let i = 0; i < prefix.length; i++) {
        if (prefix[i] === null || full[i] === null) {
          expect(full[i]).toBe(prefix[i]);
        } else {
          expect(full[i]).toBeCloseTo(prefix[i] as number, 10);
        }
      }
    });
  }
});

describe("buildSignalEvidence", () => {
  const report = buildSignalEvidence(syntheticInputs(700), new Date("2026-07-21T00:00:00Z"));

  it("evaluates every signal at every horizon and threshold", () => {
    expect(report.signals).toHaveLength(SIGNALS.length);
    for (const s of report.signals) {
      expect(s.cells).toHaveLength(EVAL_HORIZONS.length * EVAL_THRESHOLDS.length);
      expect(["strong", "moderate", "weak", "redundant", "unstable", "insufficient"]).toContain(s.verdict);
    }
  });

  it("never measures the benchmark against itself", () => {
    const benchmark = report.signals.find((s) => s.key === BENCHMARK_SIGNAL_KEY)!;
    expect(benchmark.cells.every((c) => c.beyondVol === null)).toBe(true);
    const other = report.signals.find((s) => s.key !== BENCHMARK_SIGNAL_KEY && s.cells.some((c) => c.n > 0));
    expect(other?.cells.some((c) => c.beyondVol !== null)).toBe(true);
  });

  it("marks the month horizon secondary so it cannot drive a verdict", () => {
    for (const s of report.signals) {
      for (const c of s.cells) {
        expect(c.secondary).toBe(c.horizonKey === "1m");
      }
    }
  });

  it("counts distinct episodes at or below raw hit counts", () => {
    for (const s of report.signals) {
      for (const c of s.cells) {
        expect(c.hitEpisodes).toBeLessThanOrEqual(c.hits);
      }
    }
  });

  it("reports regime occupancy summing to one across regimes", () => {
    const total = report.regimes.reduce((a, r) => a + (Number.isFinite(r.occupancyShare) ? r.occupancyShare : 0), 0);
    expect(total).toBeCloseTo(1, 5);
  });
});
