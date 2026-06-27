/**
 * Shared types for the capital-allocation forecaster. The four investable asset
 * classes the model reasons over. PSX equity is represented by the KSE-100 at
 * the asset-class level; per-sector sub-allocation is a presentation refinement
 * layered on top of the equity sleeve, not a separate optimisation axis.
 */
export type AssetClass = "equity" | "gold" | "btc" | "cash";

export const ASSET_CLASSES: AssetClass[] = ["equity", "gold", "btc", "cash"];

export const ASSET_LABEL: Record<AssetClass, string> = {
  equity: "PSX equity",
  gold: "Gold",
  btc: "Bitcoin",
  cash: "Cash / T-bills",
};

/** A weight vector over the asset classes, summing to 1. */
export type Allocation = Record<AssetClass, number>;

/** One month of real-PKR return per asset class, aligned across assets. */
export interface MonthlyReturns {
  month: string; // YYYY-MM
  returns: Allocation; // real (CPI-adjusted) monthly return per asset
}

/** Per-asset return/risk estimates feeding the optimiser. */
export interface AssetEstimate {
  asset: AssetClass;
  /** Annualised real return, after conservative shrinkage. */
  expReturn: number;
  /** Conservative low/high band (annualised real return) from bootstrap. */
  expReturnLow: number;
  expReturnHigh: number;
  /** Annualised volatility. */
  volatility: number;
  /** Months of data behind this estimate (evidence depth). */
  months: number;
}

/** The full estimation output: per-asset estimates plus the covariance matrix. */
export interface ReturnModel {
  estimates: Record<AssetClass, AssetEstimate>;
  /** Annualised covariance matrix, indexed by ASSET_CLASSES order. */
  covariance: number[][];
  /** Months in the aligned sample. */
  months: number;
  firstMonth: string | null;
  lastMonth: string | null;
}

/** Outcome distribution for a candidate mix over the horizon. */
export interface MixOutcome {
  allocation: Allocation;
  /** Annualised expected real return (point) and conservative band. */
  expReturn: number;
  expReturnLow: number;
  expReturnHigh: number;
  /** Annualised volatility of the mix. */
  volatility: number;
  /** Estimated worst-case drawdown over the horizon (positive fraction). */
  estDrawdown: number;
  /** Probability the mix delivers a negative real return over the horizon. */
  probLoss: number;
  /** One-off transaction cost (fraction of capital) to move from current mix. */
  turnoverCost: number;
}
