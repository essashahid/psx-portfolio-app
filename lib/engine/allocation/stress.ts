import { ASSET_CLASSES, type AssetClass, type Allocation } from "./types";

/**
 * Deterministic stress scenarios: instantaneous real-PKR shocks per asset class.
 * A mix's stressed return is just the weighted sum of the shocks. These are
 * fixed, documented assumptions (not model output) so a reader can see exactly
 * how each mix behaves in a named shock, and compare against the 60-20-20 base.
 */

export interface StressScenario {
  id: string;
  label: string;
  note: string;
  shock: Record<AssetClass, number>; // real-PKR instantaneous return per asset
}

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: "pkr_devaluation",
    label: "Sharp PKR devaluation",
    note: "Rupee falls ~20%. USD-priced gold and BTC gain in PKR terms; cash loses real value.",
    shock: { equity: -0.05, gold: 0.18, btc: 0.18, cash: -0.08 },
  },
  {
    id: "equity_drawdown",
    label: "KSE-100 drawdown",
    note: "PSX equity falls 25% on a domestic shock; havens hold up.",
    shock: { equity: -0.25, gold: 0.03, btc: -0.05, cash: 0.0 },
  },
  {
    id: "gold_spike",
    label: "Gold spike",
    note: "Gold rallies 20% on global risk and rupee weakness.",
    shock: { equity: -0.03, gold: 0.2, btc: 0.02, cash: 0.0 },
  },
  {
    id: "btc_crash",
    label: "Bitcoin crash",
    note: "BTC halves in a crypto-wide deleveraging.",
    shock: { equity: -0.02, gold: 0.02, btc: -0.5, cash: 0.0 },
  },
  {
    id: "rate_shock",
    label: "Rate shock (+300bps)",
    note: "SBP tightens hard. Cash yield rises; long-duration risk assets derate.",
    shock: { equity: -0.08, gold: -0.04, btc: -0.06, cash: 0.02 },
  },
  {
    id: "global_risk_off",
    label: "Global risk-off",
    note: "External shock drives a flight to safety; gold and cash cushion.",
    shock: { equity: -0.15, gold: 0.08, btc: -0.3, cash: 0.01 },
  },
];

export interface StressResult {
  id: string;
  label: string;
  note: string;
  /** Signed real-PKR return of the mix in the shock (negative = loss). */
  mixReturn: number;
}

export function stressMix(weights: Allocation): StressResult[] {
  return STRESS_SCENARIOS.map((s) => ({
    id: s.id,
    label: s.label,
    note: s.note,
    mixReturn: ASSET_CLASSES.reduce((sum, a) => sum + weights[a] * s.shock[a], 0),
  }));
}

/** Worst-case stressed return across all scenarios (most negative). */
export function worstCaseStress(weights: Allocation): StressResult {
  const results = stressMix(weights);
  return results.reduce((worst, r) => (r.mixReturn < worst.mixReturn ? r : worst), results[0]);
}
