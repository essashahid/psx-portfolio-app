import { predictionsFrom, MODEL_VERSION } from "@/lib/engine/outlook/scorecard";
import type { ExperimentalOutlook } from "@/lib/engine/outlook/experimental-outlook";

/**
 * The scorecard's whole value is that it records what was actually said, before
 * the outcome was knowable, and never records anything the models were not
 * allowed to claim. These cover both.
 */

function outlookWith(overrides: Partial<ExperimentalOutlook["horizons"][number]>[]): ExperimentalOutlook {
  const horizons = overrides.map((o) => ({
    sessions: 10,
    label: "Next two weeks",
    direction: { status: "withheld" as const, reason: "failed", band: 0.015 },
    expectedReturn: { status: "withheld" as const, reason: "failed" },
    closingRange: { status: "withheld" as const, reason: "failed" },
    tradingRange: { status: "withheld" as const, reason: "failed" },
    drawdownRisk: [],
    scenarios: { status: "withheld" as const, reason: "failed" },
    keyLevels: { supports: [], resistances: [] },
    ...o,
  })) as ExperimentalOutlook["horizons"];

  return {
    generatedAt: "2026-07-24T00:00:00.000Z",
    asOf: "2026-07-24",
    close: 176000,
    approved: false,
    label: "experimental",
    riskLevel: "elevated",
    context: { trend: "up", rsi14: 55, volumeConfirmation: 1.1, note: "" },
    horizons,
    technicals: null,
    drivers: [],
    notes: [],
  };
}

describe("predictionsFrom", () => {
  it("records only outputs that passed their gate", () => {
    // A horizon where everything failed must produce nothing at all. Recording
    // a withheld output would let it accumulate a live record it was never
    // allowed to gather, and then be promoted on that basis.
    const outlook = outlookWith([{}]);
    expect(predictionsFrom(outlook)).toHaveLength(0);
  });

  it("captures the direction probabilities exactly as shown", () => {
    const outlook = outlookWith([
      {
        sessions: 10,
        direction: { status: "ok", probs: { fall: 0.25, sideways: 0.3, rise: 0.45 }, band: 0.015, model: "logit-vol-breadth" },
      },
    ]);
    const rows = predictionsFrom(outlook);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trade_date: "2026-07-24",
      horizon: 10,
      task: "direction",
      model: "logit-vol-breadth",
      model_version: MODEL_VERSION,
      entry_close: 176000,
      p_rise: 0.45,
      p_sideways: 0.3,
      p_fall: 0.25,
      sideways_band: 0.015,
    });
  });

  it("captures range bounds as fractions, not index levels", () => {
    // Storing fractions keeps a scored result comparable across sessions at
    // different index levels.
    const outlook = outlookWith([
      { sessions: 5, tradingRange: { status: "ok", loPct: -0.045, hiPct: 0.053, loIndex: 168000, hiIndex: 185000 } },
    ]);
    const rows = predictionsFrom(outlook);
    expect(rows[0]).toMatchObject({ task: "trading-range", range_lo: -0.045, range_hi: 0.053 });
  });

  it("records each passing drawdown threshold and skips withheld ones", () => {
    const outlook = outlookWith([
      {
        sessions: 5,
        drawdownRisk: [
          { threshold: -0.03, status: "ok", p: 0.18, model: "vol-scaled-cdf" },
          { threshold: -0.05, status: "withheld", reason: "failed its gate" },
        ],
      },
    ]);
    const rows = predictionsFrom(outlook);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: "drawdown", threshold: -0.03, p_drawdown: 0.18 });
  });

  it("emits one row per passing output across horizons", () => {
    const outlook = outlookWith([
      { sessions: 5, tradingRange: { status: "ok", loPct: -0.04, hiPct: 0.05 }, drawdownRisk: [{ threshold: -0.03, status: "ok", p: 0.18, model: "vol-scaled-cdf" }] },
      { sessions: 10, direction: { status: "ok", probs: { fall: 0.25, sideways: 0.3, rise: 0.45 }, band: 0.015, model: "logit-vol-breadth" }, tradingRange: { status: "ok", loPct: -0.06, hiPct: 0.09 } },
      { sessions: 20, tradingRange: { status: "ok", loPct: -0.09, hiPct: 0.15 } },
    ]);
    const rows = predictionsFrom(outlook);
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.task === "trading-range")).toHaveLength(3);
    expect(rows.filter((r) => r.task === "direction")).toHaveLength(1);
    expect(rows.filter((r) => r.task === "drawdown")).toHaveLength(1);
  });

  it("leaves fields belonging to other tasks null", () => {
    // A range row must not carry direction probabilities, or a later query
    // could score it as though it had made a directional claim.
    const outlook = outlookWith([{ sessions: 5, tradingRange: { status: "ok", loPct: -0.04, hiPct: 0.05 } }]);
    const row = predictionsFrom(outlook)[0];
    expect(row.p_rise).toBeNull();
    expect(row.p_drawdown).toBeNull();
    expect(row.sideways_band).toBeNull();
  });
});
