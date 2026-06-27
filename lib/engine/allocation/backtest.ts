import { ASSET_CLASSES, type Allocation, type MonthlyReturns } from "./types";
import { buildReturnModel } from "./returns";
import { optimizeAllocation } from "./optimizer";
import { scoreRegimes, regimeTilt, REGIME_IDS, type RegimeId } from "./regimes";
import type { SignalReading } from "./signals";
import { BENCHMARK_60_20_20, BENCHMARK_EQUAL, BENCHMARK_EQUITY } from "./objective";

/**
 * Layered walk-forward validation. Each layer carries its OWN evidence window
 * and observation count; we never pool them into one headline number.
 *
 *  - Core / full-universe: the plain optimiser on a trailing window, tested over
 *    the longest window where the priced assets all have data.
 *  - Signal overlap: a "core" model (optimiser only) vs an "enhanced" model
 *    (optimiser + momentum-driven regime tilt) over the same window, to measure
 *    whether the regime overlay adds out-of-sample value. Macro/flow signals are
 *    applied live but kept out of the historical test (and capped) because their
 *    own history is too short to validate here.
 *
 * All allocations are formed point-in-time (train on data up to t, realise t+1).
 */

const MIN_TRAIN_MONTHS = 24;

export interface StrategyStats {
  name: string;
  annReturn: number;
  annVol: number;
  maxDrawdown: number;
  hitRate: number;
  months: number;
}

export interface BacktestLayer {
  label: string;
  firstMonth: string | null;
  lastMonth: string | null;
  observations: number;
}

export interface BacktestResult {
  core: BacktestLayer;
  fullUniverse: BacktestLayer;
  signalOverlap: BacktestLayer;
  strategies: StrategyStats[];
  /** Whether the enhanced (regime-overlay) model beat the plain optimiser net. */
  enhancedAddsValue: boolean;
  enhancedVsCoreReturn: number;
  /** Honest caveat when the layers do not actually span different histories. */
  note: string;
}

type Allocator = (train: MonthlyReturns[]) => Allocation;

function maxDrawdown(returns: number[]): number {
  let wealth = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of returns) {
    wealth *= 1 + r;
    peak = Math.max(peak, wealth);
    mdd = Math.max(mdd, (peak - wealth) / peak);
  }
  return mdd;
}

function annualise(monthly: number[]): { annReturn: number; annVol: number; hitRate: number } {
  if (monthly.length === 0) return { annReturn: 0, annVol: 0, hitRate: 0 };
  const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
  const variance = monthly.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, monthly.length - 1);
  const annReturn = Math.pow(1 + mean, 12) - 1;
  const annVol = Math.sqrt(variance) * Math.sqrt(12);
  const hitRate = monthly.filter((r) => r > 0).length / monthly.length;
  return { annReturn, annVol, hitRate };
}

/** Realised monthly return of a mix in a given month. */
function realise(weights: Allocation, month: MonthlyReturns): number {
  return ASSET_CLASSES.reduce((s, a) => s + weights[a] * month.returns[a], 0);
}

/** Walk forward: train on [0..t], hold the allocation through month t+1. */
function walkForward(series: MonthlyReturns[], allocate: Allocator): number[] {
  const realised: number[] = [];
  for (let t = MIN_TRAIN_MONTHS; t < series.length - 1; t++) {
    const weights = allocate(series.slice(0, t + 1));
    realised.push(realise(weights, series[t + 1]));
  }
  return realised;
}

const fixedAllocator = (w: Allocation): Allocator => () => w;

const coreAllocator: Allocator = (train) => optimizeAllocation(buildReturnModel(train)).allocation;

/** Momentum-only point-in-time signals (computable purely from the train set). */
function momentumSignals(train: MonthlyReturns[]): SignalReading[] {
  if (train.length < 6) return [];
  const trailing = (key: "equity" | "gold" | "btc") =>
    train.slice(-6).reduce((acc, m) => acc * (1 + m.returns[key]), 1) - 1;
  const tanh = (x: number) => Math.tanh(x);
  return [
    { id: "equity_momentum", label: "", value: tanh(trailing("equity") * 3), reliability: "good", detail: "" },
    { id: "gold_momentum", label: "", value: tanh(trailing("gold") * 3), reliability: "good", detail: "" },
    { id: "btc_momentum", label: "", value: tanh(trailing("btc") * 1.5), reliability: "medium", detail: "" },
  ];
}

/** Enhanced allocator: probability-weighted regime tilt on the optimiser. */
const enhancedAllocator: Allocator = (train) => {
  const model = buildReturnModel(train);
  const regimes = scoreRegimes(momentumSignals(train));
  const probById = Object.fromEntries(regimes.map((r) => [r.id, r.probability])) as Record<RegimeId, number>;
  // Blend per-asset tilt weighted by regime probability.
  const override: Partial<Record<(typeof ASSET_CLASSES)[number], number>> = {};
  for (const a of ASSET_CLASSES) {
    let tilt = 0;
    for (const id of REGIME_IDS) tilt += (probById[id] ?? 0) * (regimeTilt(id)[a] ?? 0);
    override[a] = model.estimates[a].expReturn + tilt;
  }
  return optimizeAllocation(model, { expReturnOverride: override }).allocation;
};

function statsFor(name: string, monthly: number[]): StrategyStats {
  const { annReturn, annVol, hitRate } = annualise(monthly);
  return { name, annReturn, annVol, maxDrawdown: maxDrawdown(monthly), hitRate, months: monthly.length };
}

/**
 * Run the layered backtest. `assetFirstMonths` lets the caller report each
 * asset's true data start so the layers carry honest evidence windows.
 */
export function runBacktest(
  series: MonthlyReturns[],
  assetFirstMonths?: { equity: string | null; gold: string | null; btc: string | null }
): BacktestResult {
  const core = walkForward(series, coreAllocator);
  const enhanced = walkForward(series, enhancedAllocator);
  const bench6020 = walkForward(series, fixedAllocator(BENCHMARK_60_20_20));
  const benchEqual = walkForward(series, fixedAllocator(BENCHMARK_EQUAL));
  const benchEquity = walkForward(series, fixedAllocator(BENCHMARK_EQUITY));

  const coreStats = statsFor("Model (optimiser)", core);
  const enhancedStats = statsFor("Model (regime overlay)", enhanced);

  const strategies: StrategyStats[] = [
    enhancedStats,
    coreStats,
    statsFor("60-20-20 benchmark", bench6020),
    statsFor("Equal weight", benchEqual),
    statsFor("All KSE-100", benchEquity),
  ];

  const obs = core.length;
  const btcFirst = assetFirstMonths?.btc ?? series[0]?.month ?? null;
  const equityFirst = assetFirstMonths?.equity ?? series[0]?.month ?? null;
  const dataLast = series[series.length - 1]?.month ?? null;
  const oosFirst = series[MIN_TRAIN_MONTHS + 1]?.month ?? null;

  // The aligned matrix is capped by the shortest priced history. When equity
  // (KSE-100) is the limiter, the "core" and "four-asset" windows coincide;
  // say so rather than implying two independent evidence periods.
  const equityLimited = (btcFirst ?? "") <= (equityFirst ?? "");
  const note = equityLimited
    ? "Core and four-asset windows coincide: KSE-100 history (not BTC) caps the aligned sample. Treat as one ~" +
      `${Math.round(series.length / 12)}-year window with ${obs} out-of-sample observations.`
    : "Four-asset window is shorter than the core window because BTC history starts later.";

  return {
    core: { label: "Core data window (equity, gold, cash)", firstMonth: equityFirst, lastMonth: dataLast, observations: obs },
    fullUniverse: { label: "Four-asset data window incl. BTC", firstMonth: btcFirst, lastMonth: dataLast, observations: obs },
    signalOverlap: { label: "Out-of-sample window (regime overlay vs plain optimiser)", firstMonth: oosFirst, lastMonth: dataLast, observations: obs },
    strategies,
    enhancedAddsValue: enhancedStats.annReturn > coreStats.annReturn && enhancedStats.maxDrawdown <= coreStats.maxDrawdown + 0.02,
    enhancedVsCoreReturn: enhancedStats.annReturn - coreStats.annReturn,
    note,
  };
}
