import type { MonthlyReturns } from "./types";
import type { DailyPoint } from "./data";
import { PBS_NATIONAL_CPI } from "@/lib/market-data/pbs-cpi";

/**
 * Forward-looking signals beyond price momentum: asset-specific demand and macro
 * readings, each tagged with a reliability level so short-history or weak-data
 * signals can be down-weighted (and capped) by the regime scorer. Every reading
 * is normalised to roughly [-1, 1] with a documented derivation. Where a signal
 * cannot be computed from reliable data it is marked "unavailable" and omitted
 * rather than guessed.
 */

export type SignalReliability = "good" | "medium" | "low" | "unavailable";

export type SignalId =
  | "equity_momentum"
  | "gold_momentum"
  | "btc_momentum"
  | "pkr_depreciation"
  | "real_rate"
  | "inflation_trend"
  | "foreign_flows"
  | "global_risk";

export interface SignalReading {
  id: SignalId;
  label: string;
  /** Normalised reading, roughly [-1, 1]. Sign convention documented per signal. */
  value: number;
  reliability: SignalReliability;
  detail: string;
}

const tanh = (x: number) => Math.tanh(x);

/** Trailing cumulative real return over the last `n` months of a series. */
function trailingReturn(series: MonthlyReturns[], key: "equity" | "gold" | "btc", n: number): number | null {
  if (series.length < n) return null;
  const slice = series.slice(-n);
  return slice.reduce((acc, m) => acc * (1 + m.returns[key]), 1) - 1;
}

/** Annualised PKR depreciation over the last ~6 months from a USD/PKR series. */
function pkrDepreciation(usdpkr: DailyPoint[]): number | null {
  if (usdpkr.length < 2) return null;
  const sorted = [...usdpkr].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  const sixMonthsAgo = sorted.find((p) => Date.parse(p.date) >= Date.parse(last.date) - 183 * 86_400_000);
  if (!sixMonthsAgo || sixMonthsAgo.value <= 0) return null;
  const halfYear = last.value / sixMonthsAgo.value - 1;
  return Math.pow(1 + halfYear, 2) - 1; // annualise the half-year move
}

/** CPI year-over-year inflation at the latest seeded month, and its 3-month trend. */
function inflationReadings(): { yoy: number | null; trend: number | null } {
  const months = Object.keys(PBS_NATIONAL_CPI).sort();
  if (months.length < 15) return { yoy: null, trend: null };
  const yoyAt = (i: number): number | null => {
    if (i < 12) return null;
    const cur = PBS_NATIONAL_CPI[months[i]];
    const prior = PBS_NATIONAL_CPI[months[i - 12]];
    return prior > 0 ? cur / prior - 1 : null;
  };
  const last = months.length - 1;
  const yoy = yoyAt(last);
  const yoy3ago = yoyAt(last - 3);
  const trend = yoy !== null && yoy3ago !== null ? yoy - yoy3ago : null;
  return { yoy, trend };
}

export interface SignalInputs {
  series: MonthlyReturns[];
  usdpkr: DailyPoint[];
  /** Current annualised T-bill / policy yield (%). */
  tbillYieldPct: number;
  /** Net foreign flow direction, -1..1, or null if unavailable (short history). */
  foreignFlowBias?: number | null;
  /** Global risk reading from structured events, -1..1 (positive = risk-off). */
  globalRiskBias?: number | null;
}

/** Compute the full signal vector with reliability tags. */
export function gatherSignals(inputs: SignalInputs): SignalReading[] {
  const out: SignalReading[] = [];
  const { series } = inputs;

  // --- Momentum (positive = rising). 6-month trailing, tanh-normalised. ---
  const eqM = trailingReturn(series, "equity", 6);
  if (eqM !== null)
    out.push({ id: "equity_momentum", label: "PSX equity momentum", value: tanh(eqM * 3), reliability: "good", detail: `KSE-100 real return ${(eqM * 100).toFixed(1)}% over 6 months.` });
  const gdM = trailingReturn(series, "gold", 6);
  if (gdM !== null)
    out.push({ id: "gold_momentum", label: "Gold momentum (PKR)", value: tanh(gdM * 3), reliability: "good", detail: `Gold real return ${(gdM * 100).toFixed(1)}% over 6 months.` });
  const btM = trailingReturn(series, "btc", 6);
  if (btM !== null)
    out.push({ id: "btc_momentum", label: "Bitcoin momentum (PKR)", value: tanh(btM * 1.5), reliability: "medium", detail: `BTC real return ${(btM * 100).toFixed(1)}% over 6 months.` });

  // --- PKR depreciation (positive = rupee weakening). ---
  const dep = pkrDepreciation(inputs.usdpkr);
  if (dep !== null)
    out.push({ id: "pkr_depreciation", label: "PKR depreciation", value: tanh(dep * 6), reliability: "good", detail: `USD/PKR implies ~${(dep * 100).toFixed(1)}% annualised rupee weakness.` });

  // --- Real rate (positive = high real yield, supports cash). ---
  const { yoy, trend } = inflationReadings();
  if (yoy !== null) {
    const realRate = inputs.tbillYieldPct / 100 - yoy;
    out.push({ id: "real_rate", label: "Real T-bill yield", value: tanh(realRate * 6), reliability: "good", detail: `T-bill ${inputs.tbillYieldPct.toFixed(1)}% minus CPI ${(yoy * 100).toFixed(1)}% = ${(realRate * 100).toFixed(1)}% real.` });
  }
  // --- Inflation trend (positive = inflation rising). ---
  if (trend !== null)
    out.push({ id: "inflation_trend", label: "Inflation trend", value: tanh(trend * 12), reliability: "good", detail: `CPI YoY ${trend >= 0 ? "rising" : "falling"} ${(Math.abs(trend) * 100).toFixed(1)}pp over 3 months.` });

  // --- Foreign flows (positive = net buying PSX). Short history -> medium. ---
  if (inputs.foreignFlowBias != null)
    out.push({ id: "foreign_flows", label: "Foreign flows into PSX", value: Math.max(-1, Math.min(1, inputs.foreignFlowBias)), reliability: "medium", detail: `Net foreign positioning bias ${inputs.foreignFlowBias >= 0 ? "positive" : "negative"}.` });

  // --- Global risk (positive = risk-off) from structured events. Low data. ---
  if (inputs.globalRiskBias != null)
    out.push({ id: "global_risk", label: "Global risk-off pressure", value: Math.max(-1, Math.min(1, inputs.globalRiskBias)), reliability: "low", detail: "Derived from recent macro/geopolitical news flow." });

  return out;
}
