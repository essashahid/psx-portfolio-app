import { ASSET_CLASSES, type AssetClass, type MonthlyReturns, type AssetEstimate, type ReturnModel } from "./types";
import { RETURN_PRIORS, MAX_ASSET_SHARPE } from "./objective";

/**
 * Turns aligned monthly real-PKR returns into the conservative return/risk model
 * the optimiser consumes. Three deliberate guards against chasing noise:
 *   1. Shrink each asset's sample mean toward a modest long-run prior, weighted
 *      by how much data backs it (more months -> less shrinkage).
 *   2. Cap the implied Sharpe so a quiet sample cannot imply a silly return.
 *   3. Report a bootstrap low/high band, not just a point estimate.
 */

const PRIOR_STRENGTH_MONTHS = 60; // a 5-year-equivalent prior weight
const BLOCK_SIZE = 6; // months per bootstrap block (preserves autocorrelation)
const BOOTSTRAP_SAMPLES = 400;
const BAND_LOW_PCT = 0.1;
const BAND_HIGH_PCT = 0.9;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function covariance(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (n - 1);
}

function annualisedVol(monthly: number[]): number {
  return Math.sqrt(Math.max(0, covariance(monthly, monthly))) * Math.sqrt(12);
}

/** Shrink a monthly sample mean to an annualised, Sharpe-capped real return. */
function shrunkAnnualReturn(monthly: number[], asset: AssetClass, vol: number): number {
  const months = monthly.length;
  const sampleAnnual = mean(monthly) * 12;
  const w = months / (months + PRIOR_STRENGTH_MONTHS);
  const prior = RETURN_PRIORS[asset];
  let shrunk = w * sampleAnnual + (1 - w) * prior;
  // Cap implied Sharpe on the upside; allow only a bounded negative drift.
  const cap = MAX_ASSET_SHARPE * vol;
  shrunk = Math.min(shrunk, cap);
  shrunk = Math.max(shrunk, -cap);
  return shrunk;
}

/** Block-bootstrap the shrunk annual return to a low/high band. */
function bootstrapBand(monthly: number[], asset: AssetClass): { low: number; high: number } {
  const n = monthly.length;
  if (n < BLOCK_SIZE * 2) {
    // Too little data to bootstrap meaningfully; widen the band conservatively.
    const vol = annualisedVol(monthly);
    const point = shrunkAnnualReturn(monthly, asset, vol);
    return { low: point - vol, high: point + vol };
  }
  const draws: number[] = [];
  for (let s = 0; s < BOOTSTRAP_SAMPLES; s++) {
    const sample: number[] = [];
    while (sample.length < n) {
      const start = Math.floor(Math.random() * (n - BLOCK_SIZE));
      for (let i = 0; i < BLOCK_SIZE && sample.length < n; i++) sample.push(monthly[start + i]);
    }
    const vol = annualisedVol(sample);
    draws.push(shrunkAnnualReturn(sample, asset, vol));
  }
  draws.sort((a, b) => a - b);
  const at = (p: number) => draws[Math.min(draws.length - 1, Math.floor(p * draws.length))];
  return { low: at(BAND_LOW_PCT), high: at(BAND_HIGH_PCT) };
}

/** Build the conservative return/risk model from aligned monthly real returns. */
export function buildReturnModel(series: MonthlyReturns[]): ReturnModel {
  const months = series.length;
  const byAsset: Record<AssetClass, number[]> = { equity: [], gold: [], btc: [], cash: [] };
  for (const row of series) {
    for (const a of ASSET_CLASSES) byAsset[a].push(row.returns[a]);
  }

  const estimates = {} as Record<AssetClass, AssetEstimate>;
  for (const a of ASSET_CLASSES) {
    const monthly = byAsset[a];
    const volatility = annualisedVol(monthly);
    const expReturn = shrunkAnnualReturn(monthly, a, volatility);
    const band = bootstrapBand(monthly, a);
    estimates[a] = {
      asset: a,
      expReturn,
      expReturnLow: Math.min(band.low, expReturn),
      expReturnHigh: Math.max(band.high, expReturn),
      volatility,
      months,
    };
  }

  // Annualised covariance matrix in ASSET_CLASSES order.
  const cov: number[][] = ASSET_CLASSES.map((ai) =>
    ASSET_CLASSES.map((aj) => covariance(byAsset[ai], byAsset[aj]) * 12)
  );

  return {
    estimates,
    covariance: cov,
    months,
    firstMonth: series[0]?.month ?? null,
    lastMonth: series[months - 1]?.month ?? null,
  };
}

/** Annualised expected real return of a mix under a return model. */
export function mixExpectedReturn(model: ReturnModel, weights: Record<AssetClass, number>): number {
  return ASSET_CLASSES.reduce((s, a) => s + weights[a] * model.estimates[a].expReturn, 0);
}

/** Annualised volatility of a mix under the covariance matrix. */
export function mixVolatility(model: ReturnModel, weights: Record<AssetClass, number>): number {
  let v = 0;
  for (let i = 0; i < ASSET_CLASSES.length; i++) {
    for (let j = 0; j < ASSET_CLASSES.length; j++) {
      v += weights[ASSET_CLASSES[i]] * weights[ASSET_CLASSES[j]] * model.covariance[i][j];
    }
  }
  return Math.sqrt(Math.max(0, v));
}
