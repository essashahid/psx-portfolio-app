import type { AssetClass, Allocation } from "./types";

/**
 * The objective, horizon and all hard constraints for the capital-allocation
 * forecaster, in one place so the UI can state plainly what is being maximised
 * and under what limits.
 *
 * Objective: maximise expected 5-year real PKR return (return net of CPI),
 * subject to per-asset bounds, a portfolio volatility cap, a drawdown cap, and
 * transaction costs on moving away from the current portfolio.
 */

export const HORIZON_YEARS = 5;
export const HORIZON_MONTHS = HORIZON_YEARS * 12;

export const OBJECTIVE_LABEL =
  "Maximise expected 5-year real PKR return within set volatility, drawdown and concentration limits";

/** Per-asset weight bounds [min, max]. A cash floor keeps liquidity; BTC is
 * capped tightly given its volatility; equity carries the growth load. */
export const BOUNDS: Record<AssetClass, { min: number; max: number }> = {
  equity: { min: 0.2, max: 0.8 },
  gold: { min: 0.0, max: 0.4 },
  btc: { min: 0.0, max: 0.15 },
  cash: { min: 0.05, max: 0.7 },
};

/** Soft portfolio-level risk limits used as optimiser penalties, not hard
 * rejects, so a feasible mix always exists. */
export const RISK_LIMITS = {
  /** Annualised volatility target; mixes above it are penalised. */
  volCap: 0.35,
  /** Horizon max-drawdown target; mixes above it are penalised. */
  drawdownCap: 0.4,
};

/** One-way transaction cost per asset (fraction of traded weight). PSX equity
 * carries brokerage + taxes; gold and BTC carry spread/withdrawal friction;
 * cash is free to move. */
export const TXN_COST_BPS: Record<AssetClass, number> = {
  equity: 50, // 0.50%
  gold: 100, // 1.00%
  btc: 120, // 1.20%
  cash: 0,
};

/**
 * The naive baseline we must beat: a fixed 60-20-20 low/medium/high-risk split.
 * Interpreted at the asset-class level as 60% low-risk cash/T-bills, 20% medium
 * (PSX equity), 20% high (split gold and BTC). Carried through the whole
 * pipeline so every recommendation can be shown to add value, or not, over it.
 */
export const BENCHMARK_60_20_20: Allocation = {
  cash: 0.6,
  equity: 0.2,
  gold: 0.1,
  btc: 0.1,
};

/** Equal-weight reference. */
export const BENCHMARK_EQUAL: Allocation = { equity: 0.25, gold: 0.25, btc: 0.25, cash: 0.25 };

/** All-equity (KSE-100) reference. */
export const BENCHMARK_EQUITY: Allocation = { equity: 1, gold: 0, btc: 0, cash: 0 };

/**
 * Conservative long-run real-return priors (annualised) per asset class, used
 * to shrink noisy historical means toward something defensible. Deliberately
 * modest so the optimiser does not chase past outperformance.
 */
export const RETURN_PRIORS: Record<AssetClass, number> = {
  equity: 0.05, // ~5% real over the cycle
  gold: 0.01, // a store of value, not a yield engine
  btc: 0.06, // high uncertainty; prior kept well below trailing history
  cash: 0.0, // real T-bill return hovers near zero; data refines it
};

/** Cap on the implied annualised Sharpe any single asset estimate may carry,
 * so a quiet sample cannot imply an implausible risk-adjusted return. */
export const MAX_ASSET_SHARPE = 0.8;
