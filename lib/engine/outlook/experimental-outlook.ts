import type { ForecastDataset, WfHorizon } from "@/lib/engine/outlook/walkforward";
import { WF_HORIZONS, SIDEWAYS_BAND, DRAWDOWN_TARGETS, directionClass } from "@/lib/engine/outlook/walkforward";
import {
  fitLogistic,
  predictLogistic,
  fitMultinomial,
  predictMultinomial,
  fitRidge,
  predictRidge,
  fitVolScaled,
  volScaledQuantile,
  volScaledCdf,
  quantileOf,
} from "@/lib/engine/outlook/models";
import { technicalStructureAt, type Bar, type TechnicalStructure } from "@/lib/engine/outlook/technical-structure";

/**
 * The experimental outlook: one structured, customer-shaped output assembled
 * from whatever passed its walk-forward gate, with everything else withheld
 * and the reason preserved.
 *
 * Two rules run through this file. Every number is produced by the same
 * deterministic constructions the walk-forward validated, refitted on the full
 * history. And a failed task never degrades into a vaguer claim: it is marked
 * withheld, and the customer-facing layer built later must render it as
 * absent.
 */

export type OutputStatus = "ok" | "withheld";

export interface GateDecision {
  task: "direction" | "return" | "closing-range" | "trading-range" | "drawdown";
  horizon: WfHorizon;
  /** For drawdown gates, the threshold the decision applies to. */
  threshold?: number;
  pass: boolean;
  selectedModel: string | null;
  reasons: string[];
}

export interface DriverEntry {
  group: "technical" | "breadth" | "flows" | "local-macro" | "global";
  name: string;
  /** Where the reading sits against its own recent history. */
  direction: "rising" | "falling" | "flat";
  /** 0-1, distance from its trailing median in percentile terms. */
  strength: number;
  effect: "supportive" | "pressuring" | "neutral";
  horizons: WfHorizon[];
  freshness: string;
  inModel: boolean;
  /** Phase 2 verdict for the underlying signal family. */
  reliability: string;
}

export interface HorizonOutlook {
  sessions: WfHorizon;
  label: string;
  direction: {
    status: OutputStatus;
    reason?: string;
    probs?: { fall: number; sideways: number; rise: number };
    band: number;
    model?: string;
  };
  expectedReturn: { status: OutputStatus; reason?: string; pct?: number; points?: number; model?: string };
  closingRange: { status: OutputStatus; reason?: string; loPct?: number; hiPct?: number; loIndex?: number; hiIndex?: number; model?: string };
  tradingRange: { status: OutputStatus; reason?: string; loPct?: number; hiPct?: number; loIndex?: number; hiIndex?: number };
  drawdownRisk: { threshold: number; status: OutputStatus; reason?: string; p?: number; model?: string }[];
  scenarios: {
    status: OutputStatus;
    reason?: string;
    /** Quantile-defined: bear=q20, base=median, bull=q80, probabilities by construction. */
    bear?: { pct: number; index: number };
    base?: { pct: number; index: number };
    bull?: { pct: number; index: number };
  };
  keyLevels: {
    supports: { price: number; distancePct: number; breakProb: number | null }[];
    resistances: { price: number; distancePct: number; breakProb: number | null }[];
  };
}

export interface ExperimentalOutlook {
  generatedAt: string;
  asOf: string;
  close: number;
  approved: false;
  label: "experimental";
  riskLevel: "low" | "moderate" | "elevated" | "high";
  /** Contextual market posture from technicals; explicitly not a forecast. */
  context: { trend: string; rsi14: number | null; volumeConfirmation: number | null; note: string };
  horizons: HorizonOutlook[];
  technicals: TechnicalStructure | null;
  drivers: DriverEntry[];
  notes: string[];
}

const HORIZON_LABEL: Record<WfHorizon, string> = { 5: "Next week", 10: "Next two weeks", 20: "Next month" };

/** Percentile of the latest value within its own history, 0-1. */
function pitPercentile(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 60) return null;
  const current = present[present.length - 1];
  const past = present.slice(0, -1);
  return past.filter((v) => v <= current).length / past.length;
}

function directionOf(values: (number | null)[], lookback = 21): "rising" | "falling" | "flat" {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < lookback + 1) return "flat";
  const now = present[present.length - 1];
  const then = present[present.length - 1 - lookback];
  const change = now - then;
  const scale = Math.abs(then) > 1e-9 ? Math.abs(change / then) : Math.abs(change);
  if (scale < 0.02) return "flat";
  return change > 0 ? "rising" : "falling";
}

export function buildExperimentalOutlook(
  d: ForecastDataset,
  gates: GateDecision[],
  asOf = new Date()
): ExperimentalOutlook {
  const last = d.dates.length - 1;
  const close = d.close[last];
  const bars: Bar[] = d.dates.map((date, i) => ({ date, close: d.close[i], volume: null }));
  const technicals = technicalStructureAt(bars, last);

  const vol = d.vol21[last];
  const adv = d.adv10[last];
  const up = d.upvol10[last];
  const sigma = d.ewmaSigma[last];
  const trendUp = d.trendUp[last];
  const features = vol !== null && adv !== null && up !== null ? [vol, adv, up] : null;

  const sigmaPct = pitPercentile(d.ewmaSigma);
  const riskLevel: ExperimentalOutlook["riskLevel"] =
    sigmaPct === null ? "moderate" : sigmaPct < 1 / 3 ? "low" : sigmaPct < 2 / 3 ? "moderate" : sigmaPct < 0.9 ? "elevated" : "high";

  const decision = (task: GateDecision["task"], horizon: WfHorizon, threshold?: number): GateDecision | undefined =>
    gates.find((g) => g.task === task && g.horizon === horizon && (threshold === undefined || g.threshold === threshold));

  const horizons: HorizonOutlook[] = WF_HORIZONS.map((h) => {
    const band = SIDEWAYS_BAND[h];
    const sigmaScale = sigma !== null ? sigma * Math.sqrt(h) : null;

    // Full-history training rows for the production-style refit.
    const rows: { features: number[]; ret: number; min: number; sigmaScale: number; trendUp: boolean }[] = [];
    for (let i = 0; i < d.dates.length; i++) {
      const v = d.vol21[i];
      const a = d.adv10[i];
      const u = d.upvol10[i];
      const s = d.ewmaSigma[i];
      const t = d.trendUp[i];
      const ret = d.outcomes[h].ret[i];
      const min = d.outcomes[h].min[i];
      if (v === null || a === null || u === null || s === null || t === null || ret === null || min === null) continue;
      rows.push({ features: [v, a, u], ret, min, sigmaScale: s * Math.sqrt(h), trendUp: t });
    }

    const volScaledRet = fitVolScaled(rows.map((r) => r.ret), rows.map((r) => r.sigmaScale));
    const volScaledMin = fitVolScaled(rows.map((r) => r.min), rows.map((r) => r.sigmaScale));
    const maxOutcomes: number[] = [];
    const maxScales: number[] = [];
    for (let i = 0; i < d.dates.length; i++) {
      const s = d.ewmaSigma[i];
      const mx = d.outcomes[h].max[i];
      const v = d.vol21[i];
      const a = d.adv10[i];
      const u = d.upvol10[i];
      if (s === null || mx === null || v === null || a === null || u === null) continue;
      maxOutcomes.push(mx);
      maxScales.push(s * Math.sqrt(h));
    }
    const volScaledMaxFit = fitVolScaled(maxOutcomes, maxScales);

    const out: HorizonOutlook = {
      sessions: h,
      label: HORIZON_LABEL[h],
      direction: { status: "withheld", reason: "not evaluated", band },
      expectedReturn: { status: "withheld", reason: "not evaluated" },
      closingRange: { status: "withheld", reason: "not evaluated" },
      tradingRange: { status: "withheld", reason: "not evaluated" },
      drawdownRisk: [],
      scenarios: { status: "withheld", reason: "not evaluated" },
      keyLevels: { supports: [], resistances: [] },
    };

    // Direction.
    const dirGate = decision("direction", h);
    if (dirGate?.pass && features && dirGate.selectedModel) {
      const yCls = rows.map((r) => directionClass(r.ret, band));
      const X =
        dirGate.selectedModel === "logit-vol" ? rows.map((r) => [r.features[0]]) : rows.map((r) => r.features);
      const model = fitMultinomial(X, yCls);
      const probs = predictMultinomial(model, dirGate.selectedModel === "logit-vol" ? [features[0]] : features);
      out.direction = {
        status: "ok",
        probs: { fall: probs[0], sideways: probs[1], rise: probs[2] },
        band,
        model: dirGate.selectedModel,
      };
    } else if (dirGate) {
      out.direction = { status: "withheld", reason: dirGate.reasons.join("; ") || "failed its walk-forward gate", band };
    }

    // Expected return. Only produced when a model actually earned it.
    const retGate = decision("return", h);
    if (retGate?.pass && features && retGate.selectedModel) {
      const model = fitRidge(rows.map((r) => r.features), rows.map((r) => r.ret));
      const pct = predictRidge(model, features);
      out.expectedReturn = { status: "ok", pct, points: Math.round(pct * close), model: retGate.selectedModel };
    } else {
      out.expectedReturn = { status: "withheld", reason: retGate?.reasons.join("; ") || "failed its walk-forward gate" };
    }

    // Ranges and scenarios from the vol-scaled distributions.
    const closeGate = decision("closing-range", h);
    const pathGate = decision("trading-range", h);
    if (sigmaScale !== null) {
      const q = (dist: typeof volScaledRet, p: number) => volScaledQuantile(dist, p, sigmaScale);
      if (closeGate?.pass) {
        const loPct = q(volScaledRet, 0.1);
        const hiPct = q(volScaledRet, 0.9);
        out.closingRange = {
          status: "ok",
          loPct,
          hiPct,
          loIndex: Math.round(close * (1 + loPct)),
          hiIndex: Math.round(close * (1 + hiPct)),
          model: closeGate.selectedModel ?? "vol-scaled",
        };
        out.scenarios = {
          status: "ok",
          bear: { pct: q(volScaledRet, 0.2), index: Math.round(close * (1 + q(volScaledRet, 0.2))) },
          base: { pct: q(volScaledRet, 0.5), index: Math.round(close * (1 + q(volScaledRet, 0.5))) },
          bull: { pct: q(volScaledRet, 0.8), index: Math.round(close * (1 + q(volScaledRet, 0.8))) },
        };
      } else if (closeGate) {
        out.closingRange = { status: "withheld", reason: closeGate.reasons.join("; ") };
        out.scenarios = { status: "withheld", reason: "scenarios derive from the closing range, which is withheld" };
      }
      if (pathGate?.pass) {
        const loPct = q(volScaledMin, 0.1);
        const hiPct = q(volScaledMaxFit, 0.9);
        out.tradingRange = {
          status: "ok",
          loPct,
          hiPct,
          loIndex: Math.round(close * (1 + loPct)),
          hiIndex: Math.round(close * (1 + hiPct)),
        };
      } else if (pathGate) {
        out.tradingRange = { status: "withheld", reason: pathGate.reasons.join("; ") };
      }
    }

    // Drawdown probabilities.
    for (const t of DRAWDOWN_TARGETS) {
      const g = decision("drawdown", h, t);
      if (g?.pass && features && sigmaScale !== null && g.selectedModel) {
        let p: number | null = null;
        if (g.selectedModel === "vol-scaled-cdf") p = volScaledCdf(volScaledMin, t, sigmaScale);
        else {
          const yHit: number[] = rows.map((r) => (r.min <= t ? 1 : 0));
          const X = g.selectedModel === "logit-vol" ? rows.map((r) => [r.features[0]]) : rows.map((r) => r.features);
          const model = fitLogistic(X, yHit);
          p = predictLogistic(model, g.selectedModel === "logit-vol" ? [features[0]] : features);
        }
        out.drawdownRisk.push({ threshold: t, status: "ok", p: p ?? undefined, model: g.selectedModel });
      } else {
        out.drawdownRisk.push({ threshold: t, status: "withheld", reason: g?.reasons.join("; ") || "failed its walk-forward gate" });
      }
    }

    // Key levels with break probabilities from the same path distributions.
    if (technicals && sigmaScale !== null) {
      out.keyLevels.supports = technicals.supports.map((l) => ({
        price: Math.round(l.price),
        distancePct: l.distance,
        breakProb: volScaledCdf(volScaledMin, l.price / close - 1, sigmaScale),
      }));
      out.keyLevels.resistances = technicals.resistances.map((l) => ({
        price: Math.round(l.price),
        distancePct: l.distance,
        breakProb: 1 - volScaledCdf(volScaledMaxFit, l.price / close - 1, sigmaScale),
      }));
    }

    return out;
  });

  // Driver attribution: model features first, then contextual readings.
  const phase2 = { vol: "strong", advance: "moderate", upvol: "moderate", flows: "unstable/redundant", pkr: "weak", policy: "unstable", gold: "weak", global: "insufficient", oil: "not tested in Phase 2" };
  const anyDrawdownModelPassed = gates.some((g) => g.task === "drawdown" && g.pass);
  const effectFromPct = (pct: number | null, riskyHigh: boolean): DriverEntry["effect"] => {
    if (pct === null) return "neutral";
    if (pct >= 2 / 3) return riskyHigh ? "pressuring" : "supportive";
    if (pct <= 1 / 3) return riskyHigh ? "supportive" : "pressuring";
    return "neutral";
  };
  const strengthOf = (pct: number | null) => (pct === null ? 0 : Math.abs(pct - 0.5) * 2);

  const volPct = pitPercentile(d.vol21);
  const advPct = pitPercentile(d.adv10);
  const upPct = pitPercentile(d.upvol10);

  const fipiProxy: (number | null)[] = []; // flows intentionally contextual-only; series lives outside the dataset
  void fipiProxy;

  const drivers: DriverEntry[] = [
    {
      group: "technical",
      name: "Realised volatility (21 sessions)",
      direction: directionOf(d.vol21),
      strength: strengthOf(volPct),
      effect: effectFromPct(volPct, true),
      horizons: [...WF_HORIZONS],
      freshness: "same session",
      inModel: anyDrawdownModelPassed,
      reliability: phase2.vol,
    },
    {
      group: "breadth",
      name: "Advance share (10-session mean)",
      direction: directionOf(d.adv10),
      strength: strengthOf(advPct),
      effect: effectFromPct(advPct, false),
      horizons: [...WF_HORIZONS],
      freshness: "same session",
      inModel: gates.some((g) => g.pass && g.selectedModel === "logit-vol-breadth"),
      reliability: phase2.advance,
    },
    {
      group: "breadth",
      name: "Up-volume share (10-session mean)",
      direction: directionOf(d.upvol10),
      strength: strengthOf(upPct),
      effect: effectFromPct(upPct, false),
      horizons: [...WF_HORIZONS],
      freshness: "same session",
      inModel: gates.some((g) => g.pass && g.selectedModel === "logit-vol-breadth"),
      reliability: phase2.upvol,
    },
    {
      group: "technical",
      name: "Trend against the 200-day average",
      direction: trendUp ? "rising" : "falling",
      strength: 0.5,
      effect: trendUp ? "supportive" : "pressuring",
      horizons: [...WF_HORIZONS],
      freshness: "same session",
      inModel: false,
      reliability: "weak (Phase 2); shown as context",
    },
  ];

  const notes = [
    "Experimental output. Not production-approved, not shown to customers, and not financial advice.",
    "Every figure is produced by the deterministic constructions validated in the walk-forward; no LLM contributed any number or level.",
    "Withheld outputs failed their walk-forward gate against a naive baseline and are absent by design, not omitted by accident.",
    "Contextual drivers (currency, rates, oil, global markets) are shown for orientation only where their Phase 2 evidence was weak; they do not feed any model output.",
  ];

  return {
    generatedAt: asOf.toISOString(),
    asOf: d.dates[last],
    close,
    approved: false,
    label: "experimental",
    riskLevel,
    context: {
      trend: technicals?.trend ?? "unknown",
      rsi14: technicals?.rsi14 ?? null,
      volumeConfirmation: technicals?.volumeConfirmation ?? null,
      note: "Posture, not prediction: where price sits against its own averages and recent participation.",
    },
    horizons,
    technicals,
    drivers,
    notes,
  };
}

/** Convenience for reports: the unconditional quantile of full-history returns. */
export function unconditionalQuantile(d: ForecastDataset, h: WfHorizon, p: number): number {
  const rets = d.outcomes[h].ret.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return quantileOf(rets, p);
}
