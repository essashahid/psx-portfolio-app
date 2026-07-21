import type { AlignedInputs } from "@/lib/engine/outlook/inputs";

/**
 * The Phase 2 signal library.
 *
 * Every signal is a pure function of the aligned inputs producing one value per
 * trading date, computable strictly from data at or before that date. The
 * point-in-time discipline lives in two places: the loader applies publication
 * lags, and every window here trails. Nothing centres, nothing normalises
 * against the full sample; state assignment (which values count as risky) is
 * the evaluator's job and uses expanding history only.
 *
 * `riskyDirection` declares which tail is hypothesised to precede drawdowns.
 * The evaluation measures both tails regardless, so a wrong hypothesis shows up
 * as lift below one rather than being hidden by the framing.
 */

export type SignalFamily = "trend" | "momentum" | "volatility" | "breadth" | "flows" | "macro" | "global" | "cross-index";

export interface SignalDef {
  key: string;
  family: SignalFamily;
  label: string;
  /** Which extreme of the signal is hypothesised to be the risky one. */
  riskyDirection: "high" | "low";
  /** One value per master date, null where history or inputs are insufficient. */
  compute: (inputs: AlignedInputs) => (number | null)[];
}

// --- Window helpers, all trailing --------------------------------------------

/** Simple return over `k` sessions; null unless both endpoints exist. */
function kReturn(series: (number | null)[], k: number): (number | null)[] {
  return series.map((v, i) => {
    if (i < k) return null;
    const then = series[i - k];
    if (v === null || then === null || then <= 0) return null;
    return v / then - 1;
  });
}

/** Trailing mean over `window` entries, requiring 80% of them present. */
function trailingMean(series: (number | null)[], window: number): (number | null)[] {
  return series.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = series.slice(i + 1 - window, i + 1).filter((v): v is number => v !== null);
    if (slice.length < window * 0.8) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Trailing sum requiring `minPresent` non-null entries in the window. */
function trailingSum(series: (number | null)[], window: number, minPresent: number): (number | null)[] {
  return series.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = series.slice(i + 1 - window, i + 1).filter((v): v is number => v !== null);
    if (slice.length < minPresent) return null;
    return slice.reduce((a, b) => a + b, 0);
  });
}

/** Distance from the trailing `window`-mean, as a fraction. */
function distFromMa(series: (number | null)[], window: number): (number | null)[] {
  const ma = trailingMean(series, window);
  return series.map((v, i) => {
    const m = ma[i];
    if (v === null || m === null || m <= 0) return null;
    return v / m - 1;
  });
}

/** Distance from the trailing `window`-high, as a negative-or-zero fraction. */
function distFromHigh(series: (number | null)[], window: number): (number | null)[] {
  return series.map((v, i) => {
    if (v === null || i + 1 < window) return null;
    const slice = series.slice(i + 1 - window, i + 1).filter((x): x is number => x !== null);
    if (slice.length < window * 0.8) return null;
    return v / Math.max(...slice) - 1;
  });
}

/** Annualised stdev of trailing `window` daily log returns. */
function trailingVolOf(series: (number | null)[], window: number): (number | null)[] {
  return series.map((_, i) => {
    if (i < window) return null;
    const rets: number[] = [];
    for (let j = i - window + 1; j <= i; j++) {
      const a = series[j - 1];
      const b = series[j];
      if (a !== null && b !== null && a > 0 && b > 0) rets.push(Math.log(b / a));
    }
    if (rets.length < window * 0.8) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    return Math.sqrt(variance * 252);
  });
}

// --- The library --------------------------------------------------------------

/**
 * The volatility benchmark every other signal must beat. Named here so the
 * evaluator can treat it specially: redundancy is always measured against it.
 */
export const BENCHMARK_SIGNAL_KEY = "vol_21d";

export const SIGNALS: SignalDef[] = [
  // Trend and momentum on the index itself.
  { key: "mom_21d", family: "momentum", label: "KSE-100 1-month momentum", riskyDirection: "low", compute: (a) => kReturn(a.kse100.map((v) => v), 21) },
  { key: "mom_63d", family: "momentum", label: "KSE-100 3-month momentum", riskyDirection: "low", compute: (a) => kReturn(a.kse100.map((v) => v), 63) },
  { key: "dist_ma200", family: "trend", label: "KSE-100 distance from 200-day average", riskyDirection: "low", compute: (a) => distFromMa(a.kse100.map((v) => v), 200) },
  { key: "drawdown_252d", family: "trend", label: "KSE-100 drawdown from 52-week high", riskyDirection: "low", compute: (a) => distFromHigh(a.kse100.map((v) => v), 252) },

  // Volatility. vol_21d is the benchmark.
  { key: "vol_21d", family: "volatility", label: "Realised volatility, 21 sessions", riskyDirection: "high", compute: (a) => trailingVolOf(a.kse100.map((v) => v), 21) },
  { key: "vol_63d", family: "volatility", label: "Realised volatility, 63 sessions", riskyDirection: "high", compute: (a) => trailingVolOf(a.kse100.map((v) => v), 63) },

  // Breadth, reconstructed from constituents in Phase 1 follow-up work.
  { key: "breadth_ma200", family: "breadth", label: "Share of stocks above their 200-day average", riskyDirection: "low", compute: (a) => a.breadth.pctAboveMa200 },
  { key: "breadth_advance_10d", family: "breadth", label: "Advance share, 10-session mean", riskyDirection: "low", compute: (a) => trailingMean(a.breadth.advanceShare, 10) },
  { key: "breadth_newlows_10d", family: "breadth", label: "New 52-week lows share, 10-session mean", riskyDirection: "high", compute: (a) => trailingMean(a.breadth.newLowsShare, 10) },
  { key: "breadth_dispersion_10d", family: "breadth", label: "Cross-sectional dispersion, 10-session mean", riskyDirection: "high", compute: (a) => trailingMean(a.breadth.dispersion, 10) },
  { key: "breadth_upvol_10d", family: "breadth", label: "Up-volume share, 10-session mean", riskyDirection: "low", compute: (a) => trailingMean(a.breadth.upVolumeShare, 10) },

  // Foreign investor flows, lagged one session by the loader.
  { key: "fipi_net_21d", family: "flows", label: "Foreign net flow, 21-session sum (USD mn)", riskyDirection: "low", compute: (a) => trailingSum(a.fipiNet, 21, 17) },
  { key: "fipi_net_63d", family: "flows", label: "Foreign net flow, 63-session sum (USD mn)", riskyDirection: "low", compute: (a) => trailingSum(a.fipiNet, 63, 50) },

  // Macro and currency. CPI carries a publication lag; the rest are real-time steps.
  { key: "pkr_chg_63d", family: "macro", label: "PKR depreciation over 3 months", riskyDirection: "high", compute: (a) => kReturn(a.usdPkr, 63) },
  { key: "gold_mom_63d", family: "macro", label: "Gold (USD) 3-month momentum", riskyDirection: "high", compute: (a) => kReturn(a.goldUsd, 63) },
  {
    key: "policy_chg_63d",
    family: "macro",
    label: "Policy-rate change over 3 months (pp)",
    riskyDirection: "high",
    compute: (a) => a.policyRate.map((v, i) => (i < 63 ? null : v - a.policyRate[i - 63])),
  },
  {
    key: "real_policy_rate",
    family: "macro",
    label: "Real policy rate (policy minus CPI YoY)",
    riskyDirection: "low",
    compute: (a) => a.policyRate.map((v, i) => (a.cpiYoY[i] === null ? null : v - (a.cpiYoY[i] as number))),
  },

  // Global risk appetite, lagged one day since those sessions close after PKT.
  { key: "spy_dd_252d", family: "global", label: "S&P 500 proxy drawdown from 52-week high", riskyDirection: "low", compute: (a) => distFromHigh(a.spy, 252) },
  { key: "eem_mom_63d", family: "global", label: "Emerging-markets proxy 3-month momentum", riskyDirection: "low", compute: (a) => kReturn(a.eem, 63) },

  // Large-cap concentration: KSE-30 outrunning the all-share is narrow leadership.
  {
    key: "kse30_rel_21d",
    family: "cross-index",
    label: "KSE-30 vs All-Share 1-month return spread",
    riskyDirection: "high",
    compute: (a) => {
      const large = kReturn(a.kse30, 21);
      const broad = kReturn(a.allshr, 21);
      return large.map((v, i) => (v === null || broad[i] === null ? null : v - (broad[i] as number)));
    },
  },
];

/**
 * Signal pairs examined jointly. Kept deliberately few: every pair multiplies
 * the ways to fool ourselves, so each one here has a stated reason to exist.
 */
export const SIGNAL_PAIRS: { anchor: string; other: string; why: string }[] = [
  { anchor: "vol_21d", other: "breadth_ma200", why: "The Phase 1 lead: narrow participation during calm looked informative in-sample." },
  { anchor: "vol_21d", other: "dist_ma200", why: "The classic trend-volatility interaction; also the naive baseline for Phase 3." },
  { anchor: "vol_21d", other: "fipi_net_21d", why: "Foreign selling into a calm market is a hypothesised early warning." },
  { anchor: "vol_21d", other: "spy_dd_252d", why: "Local calm during global stress; tests whether global risk leads PSX." },
  { anchor: "dist_ma200", other: "breadth_ma200", why: "Index above trend while breadth deteriorates is the divergence pattern." },
];
