import type { AssetClass } from "./types";
import type { SignalReading, SignalId, SignalReliability } from "./signals";

/**
 * Macro-regime layer. A documented, deterministic scoring function maps the
 * signal vector (plus bounded structured-event contributions) to a score per
 * regime, then a softmax gives reproducible probabilities that sum to 1. The
 * probability is the likelihood of the REGIME, not of an allocation succeeding.
 *
 * Two guards keep it honest:
 *   - Reliability scales each signal's influence (good > medium > low), with an
 *     absolute per-signal contribution cap.
 *   - Short-history / weak signals (medium and low reliability) may move any
 *     regime's final probability by at most MAX_YOUNG_PROB_DELTA, by clamping
 *     the post-signal probabilities to a band around the core-signal baseline.
 */

export type RegimeId = "disinflation_easing" | "pkr_stress" | "risk_off" | "high_carry";

export const REGIMES: { id: RegimeId; label: string; thesis: string }[] = [
  {
    id: "disinflation_easing",
    label: "Disinflation & rate cuts",
    thesis: "Inflation falling and the SBP easing. Real growth assets re-rate; equity carries the load.",
  },
  {
    id: "pkr_stress",
    label: "PKR stress / stagflation",
    thesis: "Rupee under pressure with sticky inflation. Hard assets and USD-linked stores of value protect purchasing power.",
  },
  {
    id: "risk_off",
    label: "Global risk-off",
    thesis: "External shock or regional risk drives a flight to safety. Cash and gold cushion; cyclicals and BTC suffer.",
  },
  {
    id: "high_carry",
    label: "High real-rate carry",
    thesis: "Positive real yields reward patience. T-bills and dividend equity earn while risk is repriced.",
  },
];

export const REGIME_IDS = REGIMES.map((r) => r.id);

/** Reliability -> influence multiplier on a signal's score contribution. */
const RELIABILITY_WEIGHT: Record<SignalReliability, number> = {
  good: 1.0,
  medium: 0.6,
  low: 0.3,
  unavailable: 0,
};

/** Signals whose influence is additionally clamped at the probability level. */
const YOUNG_RELIABILITIES: SignalReliability[] = ["medium", "low"];
export const MAX_YOUNG_PROB_DELTA = 0.05;

/** Per-signal absolute cap on score contribution to a single regime. */
const PER_SIGNAL_CAP = 0.8;

/** How each signal pushes each regime score (signed weight on the signal value). */
const W: Record<RegimeId, Partial<Record<SignalId, number>>> = {
  disinflation_easing: {
    inflation_trend: -1.0,
    real_rate: -0.3,
    equity_momentum: 0.6,
    foreign_flows: 0.5,
    pkr_depreciation: -0.4,
    global_risk: -0.5,
  },
  pkr_stress: {
    pkr_depreciation: 1.0,
    inflation_trend: 0.7,
    gold_momentum: 0.5,
    real_rate: -0.3,
    equity_momentum: -0.2,
    global_risk: 0.3,
  },
  risk_off: {
    global_risk: 1.0,
    equity_momentum: -0.6,
    btc_momentum: -0.4,
    gold_momentum: 0.3,
    foreign_flows: -0.4,
    pkr_depreciation: 0.2,
  },
  high_carry: {
    real_rate: 1.0,
    inflation_trend: -0.2,
    equity_momentum: 0.2,
    pkr_depreciation: -0.2,
    btc_momentum: -0.2,
  },
};

/** Small prior so that, absent signals, regimes start near uniform. */
const REGIME_PRIOR: Record<RegimeId, number> = {
  disinflation_easing: 0,
  pkr_stress: 0,
  risk_off: 0,
  high_carry: 0,
};

const SOFTMAX_TEMP = 0.8;
const PROB_FLOOR = 0.05;
const PROB_CEIL = 0.85;

function softmax(scores: Record<RegimeId, number>): Record<RegimeId, number> {
  const vals = REGIME_IDS.map((r) => scores[r] / SOFTMAX_TEMP);
  const max = Math.max(...vals);
  const exps = vals.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const out = {} as Record<RegimeId, number>;
  REGIME_IDS.forEach((r, i) => (out[r] = exps[i] / sum));
  return out;
}

/** Clamp to [floor, ceil] then renormalise to sum 1. */
function clampProbs(probs: Record<RegimeId, number>): Record<RegimeId, number> {
  const clamped = {} as Record<RegimeId, number>;
  for (const r of REGIME_IDS) clamped[r] = Math.max(PROB_FLOOR, Math.min(PROB_CEIL, probs[r]));
  const sum = REGIME_IDS.reduce((s, r) => s + clamped[r], 0);
  for (const r of REGIME_IDS) clamped[r] = clamped[r] / sum;
  return clamped;
}

function scoreFrom(signals: SignalReading[], eventContribs: Partial<Record<RegimeId, number>>): Record<RegimeId, number> {
  const scores = {} as Record<RegimeId, number>;
  for (const r of REGIME_IDS) {
    let s = REGIME_PRIOR[r] + (eventContribs[r] ?? 0);
    for (const sig of signals) {
      const weight = W[r][sig.id];
      if (weight === undefined) continue;
      let contrib = weight * sig.value * RELIABILITY_WEIGHT[sig.reliability];
      contrib = Math.max(-PER_SIGNAL_CAP, Math.min(PER_SIGNAL_CAP, contrib));
      s += contrib;
    }
    scores[r] = s;
  }
  return scores;
}

export interface RegimeScore {
  id: RegimeId;
  label: string;
  thesis: string;
  probability: number;
}

/**
 * Score regimes from signals + events. Core (good-reliability) signals set the
 * baseline; medium/low signals may then adjust each regime's probability by at
 * most MAX_YOUNG_PROB_DELTA.
 */
export function scoreRegimes(
  signals: SignalReading[],
  eventContribs: Partial<Record<RegimeId, number>> = {}
): RegimeScore[] {
  const coreSignals = signals.filter((s) => !YOUNG_RELIABILITIES.includes(s.reliability));
  const baseProbs = clampProbs(softmax(scoreFrom(coreSignals, {})));
  const fullProbs = clampProbs(softmax(scoreFrom(signals, eventContribs)));

  // Clamp the young-signal + event effect to a bounded band around the baseline.
  const bounded = {} as Record<RegimeId, number>;
  for (const r of REGIME_IDS) {
    const delta = Math.max(-MAX_YOUNG_PROB_DELTA, Math.min(MAX_YOUNG_PROB_DELTA, fullProbs[r] - baseProbs[r]));
    bounded[r] = baseProbs[r] + delta;
  }
  const finalProbs = clampProbs(bounded);

  return REGIMES.map((meta) => ({
    id: meta.id,
    label: meta.label,
    thesis: meta.thesis,
    probability: finalProbs[meta.id],
  })).sort((a, b) => b.probability - a.probability);
}

/**
 * Per-regime tilt on annualised real expected returns. Makes each regime imply a
 * distinct optimal mix. Small, documented, additive to the base estimate.
 */
const REGIME_TILT: Record<RegimeId, Partial<Record<AssetClass, number>>> = {
  disinflation_easing: { equity: 0.03, btc: 0.01, cash: -0.01 },
  pkr_stress: { gold: 0.04, btc: 0.03, equity: -0.02, cash: -0.01 },
  risk_off: { cash: 0.01, gold: 0.02, equity: -0.04, btc: -0.06 },
  high_carry: { cash: 0.02, equity: 0.01, gold: -0.01, btc: -0.02 },
};

export function regimeTilt(id: RegimeId): Partial<Record<AssetClass, number>> {
  return REGIME_TILT[id];
}
