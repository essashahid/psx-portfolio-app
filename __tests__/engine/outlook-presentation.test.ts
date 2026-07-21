import {
  buildOutlookViewModel,
  confidenceFor,
  returnDomain,
  MAIN_VIEW_HORIZONS,
  MIN_EVENTS_TO_QUOTE,
} from "@/lib/engine/outlook/presentation";
import type { OutlookCoverageReport } from "@/lib/engine/outlook/coverage";
import type { HorizonStat, VolConditionalStat } from "@/lib/engine/outlook/history-stats";

/**
 * These assertions guard editorial decisions, not arithmetic: which horizons a
 * reader is shown, when a sample is too thin to quote as a rate, and how a raw
 * count becomes a confidence label. Each one is a judgement that would
 * otherwise drift silently as the data grows.
 */

function horizon(over: Partial<HorizonStat> & Pick<HorizonStat, "key">): HorizonStat {
  return {
    label: "test",
    sessions: 21,
    family: "short",
    overlappingWindows: 1000,
    independentWindows: 50,
    positiveRate: 0.6,
    returnPercentiles: { p10: -0.04, p25: -0.01, median: 0.02, p75: 0.05, p90: 0.1 },
    drawdownPercentiles: { p10: -0.08, median: -0.02, worst: -0.2 },
    runupPercentiles: { p90: 0.12, median: 0.03, best: 0.3 },
    thresholds: [
      { threshold: -0.03, hits: 400, frequency: 0.4 },
      { threshold: -0.05, hits: 200, frequency: 0.2 },
      { threshold: -0.07, hits: 90, frequency: 0.09 },
      { threshold: -0.1, hits: 30, frequency: 0.03 },
    ],
    rallyThresholds: [
      { threshold: 0.03, hits: 500, frequency: 0.5 },
      { threshold: 0.05, hits: 300, frequency: 0.3 },
      { threshold: 0.07, hits: 150, frequency: 0.15 },
      { threshold: 0.1, hits: 60, frequency: 0.06 },
    ],
    ...over,
  } as HorizonStat;
}

function report(over: Partial<OutlookCoverageReport> = {}): OutlookCoverageReport {
  return {
    generatedAt: "2026-07-21T00:00:00.000Z",
    bindingConstraint: null,
    series: [],
    missing: [],
    index: { ticker: "KSE100", points: 1253, firstDate: "2021-06-28", lastDate: "2026-07-20", years: 5.06, gaps: { gaps: [], longestGapWeekdays: 0, totalMissingWeekdays: 0 } },
    horizons: [],
    volConditional: [],
    ...over,
  } as OutlookCoverageReport;
}

describe("confidenceFor", () => {
  it("grades on independent sample size", () => {
    expect(confidenceFor(250).level).toBe("strong");
    expect(confidenceFor(100).level).toBe("strong");
    expect(confidenceFor(99).level).toBe("moderate");
    expect(confidenceFor(30).level).toBe("moderate");
    expect(confidenceFor(29).level).toBe("limited");
    expect(confidenceFor(19).level).toBe("limited");
  });

  it("maps to badge variants already used elsewhere in the platform", () => {
    expect(confidenceFor(250).variant).toBe("green");
    expect(confidenceFor(50).variant).toBe("amber");
    expect(confidenceFor(10).variant).toBe("red");
  });
});

describe("buildOutlookViewModel", () => {
  it("shows only the agreed horizons, dropping the near-duplicate and the unsupported one", () => {
    const model = buildOutlookViewModel(
      report({
        horizons: [
          horizon({ key: "5d", sessions: 5 }),
          horizon({ key: "10d", sessions: 10 }),
          horizon({ key: "20d", sessions: 20 }),
          horizon({ key: "1m", sessions: 21 }),
          horizon({ key: "3m", sessions: 63 }),
        ],
      })
    );
    expect(model.horizons.map((h) => h.key)).toEqual(MAIN_VIEW_HORIZONS);
    expect(model.horizons.map((h) => h.key)).not.toContain("20d");
    expect(model.horizons.map((h) => h.key)).not.toContain("3m");
  });

  it("orders horizons shortest first so the toggle reads left to right in time", () => {
    const model = buildOutlookViewModel(
      report({
        horizons: [horizon({ key: "1m", sessions: 21 }), horizon({ key: "5d", sessions: 5 }), horizon({ key: "10d", sessions: 10 })],
      })
    );
    expect(model.horizons.map((h) => h.sessions)).toEqual([5, 10, 21]);
  });

  it("suppresses a threshold that rests on too few real events", () => {
    // A 10% fall inside five sessions happened about once in the real history.
    // Quoting "0.1%" would present a single episode as a measured frequency.
    const model = buildOutlookViewModel(
      report({
        horizons: [
          horizon({
            key: "5d",
            sessions: 5,
            thresholds: [
              { threshold: -0.03, hits: 173, frequency: 0.139 },
              { threshold: -0.05, hits: 45, frequency: 0.036 },
              { threshold: -0.07, hits: 16, frequency: 0.013 },
              { threshold: -0.1, hits: 1, frequency: 0.001 },
            ],
          }),
        ],
      })
    );
    const shown = model.horizons[0].thresholds.map((t) => t.threshold);
    expect(shown).toEqual([-0.03, -0.05, -0.07]);
    expect(shown).not.toContain(-0.1);
    expect(model.horizons[0].thresholds.every((t) => t.hits >= MIN_EVENTS_TO_QUOTE)).toBe(true);
  });

  it("carries both directions, so the view cannot describe only declines", () => {
    const model = buildOutlookViewModel(report({ horizons: [horizon({ key: "1m" })] }));
    const h = model.horizons[0];
    expect(h.headlineFrequency).not.toBeNull();
    expect(h.headlineRallyFrequency).not.toBeNull();
    expect(h.rallyThresholds.length).toBeGreaterThan(0);
    expect(h.rallyThresholds.every((t) => t.threshold > 0)).toBe(true);
    expect(h.bestRunup).toBeGreaterThan(0);
  });

  it("applies the same evidence floor to rallies as to declines", () => {
    const model = buildOutlookViewModel(
      report({
        horizons: [
          horizon({
            key: "5d",
            rallyThresholds: [
              { threshold: 0.03, hits: 200, frequency: 0.16 },
              { threshold: 0.1, hits: 2, frequency: 0.002 },
            ],
          }),
        ],
      })
    );
    expect(model.horizons[0].rallyThresholds.map((t) => t.threshold)).toEqual([0.03]);
  });

  it("reports no headline figure when the 5% threshold is itself too thin", () => {
    const model = buildOutlookViewModel(
      report({
        horizons: [horizon({ key: "5d", thresholds: [{ threshold: -0.05, hits: 2, frequency: 0.002 }] })],
      })
    );
    expect(model.horizons[0].headlineFrequency).toBeNull();
  });

  it("drops turbulence rows whose threshold was suppressed for that horizon", () => {
    const vol = (over: Partial<VolConditionalStat>): VolConditionalStat =>
      ({ horizonKey: "5d", threshold: -0.05, baseRate: 0.04, lowVolRate: 0.01, highVolRate: 0.07, lift: 1.8, lowVolWindows: 400, highVolWindows: 400, ...over }) as VolConditionalStat;

    const model = buildOutlookViewModel(
      report({
        horizons: [
          horizon({
            key: "5d",
            thresholds: [
              { threshold: -0.05, hits: 45, frequency: 0.036 },
              { threshold: -0.1, hits: 1, frequency: 0.001 },
            ],
          }),
        ],
        volConditional: [vol({ threshold: -0.05 }), vol({ threshold: -0.1 })],
      })
    );
    expect(model.turbulence.map((t) => t.threshold)).toEqual([-0.05]);
  });

  it("classifies the direction and strength of the turbulence effect", () => {
    const vol = (lift: number): VolConditionalStat =>
      ({ horizonKey: "5d", threshold: -0.05, baseRate: 0.04, lowVolRate: 0.01, highVolRate: 0.07, lift, lowVolWindows: 400, highVolWindows: 400 }) as VolConditionalStat;
    const build = (lift: number) =>
      buildOutlookViewModel(
        report({
          horizons: [horizon({ key: "5d", thresholds: [{ threshold: -0.05, hits: 45, frequency: 0.036 }] })],
          volConditional: [vol(lift)],
        })
      ).turbulence[0].verdict;

    expect(build(2.0)).toBe("raises-risk");
    expect(build(1.0)).toBe("little-difference");
    // The three-month horizon inverted in the real data; the copy must not
    // claim turbulence raised risk when it did the opposite.
    expect(build(0.74)).toBe("lowers-risk");
  });
});

describe("returnDomain", () => {
  it("spans every shown horizon so switching widens the band instead of rescaling under it", () => {
    const model = buildOutlookViewModel(
      report({
        horizons: [
          horizon({ key: "5d", returnPercentiles: { p10: -0.027, p25: 0, median: 0.004, p75: 0, p90: 0.04 } }),
          horizon({ key: "1m", returnPercentiles: { p10: -0.045, p25: 0, median: 0.019, p75: 0, p90: 0.101 } }),
        ],
      })
    );
    const domain = returnDomain(model.horizons);
    expect(domain.min).toBeLessThan(-0.045);
    expect(domain.max).toBeGreaterThan(0.101);
  });
});
