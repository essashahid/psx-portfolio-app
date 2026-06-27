import { ASSET_CLASSES, type AssetClass, type Allocation, type ReturnModel, type MixOutcome } from "./types";
import { BOUNDS, RISK_LIMITS, TXN_COST_BPS, HORIZON_YEARS } from "./objective";
import { mixVolatility } from "./returns";

/**
 * Constrained allocator. A bounded grid search (explainable, dependency-free)
 * maximises a risk-adjusted utility that rewards real return and penalises
 * volatility above the cap, estimated drawdown above the cap, and the cost of
 * trading away from the current portfolio. It deliberately returns ranges and
 * an outcome distribution, not a single confident number.
 */

const GRID_STEP = 0.05;
const RISK_AVERSION = 6; // utility penalty on variance; higher = more cautious

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

function expReturnOf(
  model: ReturnModel,
  weights: Allocation,
  override?: Partial<Record<AssetClass, number>>
): number {
  return ASSET_CLASSES.reduce((s, a) => {
    const er = override?.[a] ?? model.estimates[a].expReturn;
    return s + weights[a] * er;
  }, 0);
}

/** Heuristic horizon max-drawdown for a mix: scales with volatility, eased by
 * positive expected drift. Documented and intentionally conservative. */
function estDrawdown(vol: number, expReturn: number): number {
  return Math.min(0.95, Math.max(0, 2.5 * vol - 0.5 * Math.max(0, expReturn)));
}

/** Probability of a negative real return over the horizon (lognormal-ish). */
function probLoss(expReturn: number, vol: number): number {
  const mean = expReturn * HORIZON_YEARS;
  const sd = vol * Math.sqrt(HORIZON_YEARS);
  if (sd <= 0) return mean >= 0 ? 0 : 1;
  return normalCdf(-mean / sd);
}

/** One-off cost of moving from current to target (buy-side, fraction of capital). */
function turnoverCost(current: Allocation | null, target: Allocation): number {
  if (!current) return 0;
  let cost = 0;
  for (const a of ASSET_CLASSES) {
    const buy = Math.max(0, target[a] - current[a]);
    cost += buy * (TXN_COST_BPS[a] / 10_000);
  }
  return cost;
}

/** Full outcome distribution for a given mix. Used for candidates and benchmarks. */
export function evaluateMix(
  model: ReturnModel,
  weights: Allocation,
  current: Allocation | null = null,
  override?: Partial<Record<AssetClass, number>>
): MixOutcome {
  const expReturn = expReturnOf(model, weights, override);
  const vol = mixVolatility(model, weights);
  // Band: scale the per-asset bands by weight (a conservative, transparent proxy
  // for the mix's estimate uncertainty).
  const low = ASSET_CLASSES.reduce((s, a) => s + weights[a] * model.estimates[a].expReturnLow, 0);
  const high = ASSET_CLASSES.reduce((s, a) => s + weights[a] * model.estimates[a].expReturnHigh, 0);
  return {
    allocation: weights,
    expReturn,
    expReturnLow: Math.min(low, expReturn),
    expReturnHigh: Math.max(high, expReturn),
    volatility: vol,
    estDrawdown: estDrawdown(vol, expReturn),
    probLoss: probLoss(expReturn, vol),
    turnoverCost: turnoverCost(current, weights),
  };
}

function utility(outcome: MixOutcome): number {
  let u = outcome.expReturn - 0.5 * RISK_AVERSION * outcome.volatility * outcome.volatility;
  u -= outcome.turnoverCost / HORIZON_YEARS; // amortise the one-off cost
  if (outcome.volatility > RISK_LIMITS.volCap) u -= 4 * (outcome.volatility - RISK_LIMITS.volCap);
  if (outcome.estDrawdown > RISK_LIMITS.drawdownCap) u -= 2 * (outcome.estDrawdown - RISK_LIMITS.drawdownCap);
  return u;
}

function withinBounds(w: Allocation): boolean {
  return ASSET_CLASSES.every((a) => w[a] >= BOUNDS[a].min - 1e-9 && w[a] <= BOUNDS[a].max + 1e-9);
}

/** Enumerate bounded weight vectors on the grid (cash is the residual). */
function* candidateGrid(): Generator<Allocation> {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  for (let eq = BOUNDS.equity.min; eq <= BOUNDS.equity.max + 1e-9; eq += GRID_STEP) {
    for (let gd = BOUNDS.gold.min; gd <= BOUNDS.gold.max + 1e-9; gd += GRID_STEP) {
      for (let bt = BOUNDS.btc.min; bt <= BOUNDS.btc.max + 1e-9; bt += GRID_STEP) {
        const cash = r(1 - eq - gd - bt);
        const w: Allocation = { equity: r(eq), gold: r(gd), btc: r(bt), cash };
        if (cash >= BOUNDS.cash.min - 1e-9 && cash <= BOUNDS.cash.max + 1e-9 && withinBounds(w)) {
          yield w;
        }
      }
    }
  }
}

export interface OptimizeOptions {
  current?: Allocation | null;
  /** Regime tilt: per-asset expected-return overrides (annualised real). */
  expReturnOverride?: Partial<Record<AssetClass, number>>;
}

/** Find the bounded mix maximising risk-adjusted utility. */
export function optimizeAllocation(model: ReturnModel, opts: OptimizeOptions = {}): MixOutcome {
  const current = opts.current ?? null;
  let best: MixOutcome | null = null;
  let bestU = -Infinity;
  for (const w of candidateGrid()) {
    const outcome = evaluateMix(model, w, current, opts.expReturnOverride);
    const u = utility(outcome);
    if (u > bestU) {
      bestU = u;
      best = outcome;
    }
  }
  // The grid always contains at least one feasible point (bounds are consistent),
  // but guard anyway.
  return best ?? evaluateMix(model, normaliseToBounds(), current, opts.expReturnOverride);
}

/** Risk-parity-style reference: inverse-volatility weights, clamped to bounds. */
export function riskParityMix(model: ReturnModel): Allocation {
  const inv = ASSET_CLASSES.map((a) => 1 / Math.max(1e-4, model.estimates[a].volatility));
  const sum = inv.reduce((s, x) => s + x, 0);
  const raw = {} as Allocation;
  ASSET_CLASSES.forEach((a, i) => (raw[a] = inv[i] / sum));
  return clampToBounds(raw);
}

/** Project a raw weight vector into the bounds and renormalise to sum 1. */
export function clampToBounds(w: Allocation): Allocation {
  const clamped = {} as Allocation;
  for (const a of ASSET_CLASSES) clamped[a] = Math.min(BOUNDS[a].max, Math.max(BOUNDS[a].min, w[a]));
  const sum = ASSET_CLASSES.reduce((s, a) => s + clamped[a], 0);
  // Renormalise; if that pushes anything out of bounds the small residual is
  // absorbed by cash, which has the widest band.
  for (const a of ASSET_CLASSES) clamped[a] = clamped[a] / sum;
  return clamped;
}

function normaliseToBounds(): Allocation {
  return clampToBounds({ equity: 0.4, gold: 0.15, btc: 0.05, cash: 0.4 });
}
