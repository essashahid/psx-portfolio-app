import type { AlignedInputs } from "@/lib/engine/outlook/inputs";
import {
  fitAnalog,
  analogSample,
  fitLogistic,
  predictLogistic,
  fitMultinomial,
  predictMultinomial,
  fitQuantile,
  predictQuantile,
  fitRidge,
  predictRidge,
  fitStumps,
  predictStumps,
  fitVolScaled,
  volScaledQuantile,
  volScaledCdf,
  quantileOf,
} from "@/lib/engine/outlook/models";

/**
 * The purged expanding walk-forward for the Phase 3 bake-off.
 *
 * Rules, all enforced structurally rather than by convention:
 *  - Expanding window only. A fold trains on everything before its boundary
 *    and predicts the sessions after it. No random splits exist anywhere.
 *  - Purging: a training row's outcome spans `h` sessions, so rows within `h`
 *    of the boundary are excluded from training. Without this, the boundary
 *    leaks the first test outcomes into the fit.
 *  - Every feature is built by the Phase 2 loader with its lags already
 *    applied, and models standardise with training-fold statistics only.
 *
 * Feature policy follows the Phase 2 verdicts: volatility is the core;
 * advance share and up-volume share are the approved breadth additions;
 * momentum appears only inside a robustness variant, so its instability can be
 * demonstrated rather than assumed.
 */

export const WF_HORIZONS = [5, 10, 20] as const;
export type WfHorizon = (typeof WF_HORIZONS)[number];

/**
 * Sideways bands per horizon, in absolute return. Fixed and documented rather
 * than estimated, so the class definition cannot leak future dispersion.
 * Chosen near the terciles of the Phase 1 return distributions.
 */
export const SIDEWAYS_BAND: Record<WfHorizon, number> = { 5: 0.01, 10: 0.015, 20: 0.025 };

export const DRAWDOWN_TARGETS = [-0.03, -0.05] as const;

/** Direction classes. Order matters: fall, sideways, rise. */
export const DIR_FALL = 0;
export const DIR_SIDE = 1;
export const DIR_RISE = 2;

export const MIN_TRAIN_ROWS = 400;
export const FOLD_STEP = 21;

// --- Dataset ------------------------------------------------------------------

export interface ForecastDataset {
  dates: string[];
  close: number[];
  /** Core features, one value per date, null before warmup. */
  vol21: (number | null)[];
  adv10: (number | null)[];
  upvol10: (number | null)[];
  mom21: (number | null)[];
  /** EWMA daily sigma (per-session fraction), the volatility forecast. */
  ewmaSigma: (number | null)[];
  trendUp: (boolean | null)[];
  /** Outcomes per horizon: close-to-close return, worst dip, best rise. */
  outcomes: Record<WfHorizon, { ret: (number | null)[]; min: (number | null)[]; max: (number | null)[] }>;
}

function trailingMeanOf(series: (number | null)[], window: number): (number | null)[] {
  return series.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = series.slice(i + 1 - window, i + 1).filter((v): v is number => v !== null);
    if (slice.length < window * 0.8) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function realizedVol(closes: number[], window: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < window) return null;
    const rets: number[] = [];
    for (let j = i - window + 1; j <= i; j++) {
      if (closes[j - 1] > 0 && closes[j] > 0) rets.push(Math.log(closes[j] / closes[j - 1]));
    }
    if (rets.length < window * 0.8) return null;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    return Math.sqrt(variance * 252);
  });
}

function ewmaSigmaSeries(closes: number[], lambda = 0.94): (number | null)[] {
  const out: (number | null)[] = [];
  let variance: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      out.push(null);
      continue;
    }
    const a = closes[i - 1];
    const b = closes[i];
    if (a > 0 && b > 0) {
      const r = Math.log(b / a);
      variance = variance === null ? r * r : lambda * variance + (1 - lambda) * r * r;
    }
    out.push(variance !== null && i >= 30 ? Math.sqrt(variance) : null);
  }
  return out;
}

export function buildForecastDataset(inputs: AlignedInputs): ForecastDataset {
  const { dates, kse100 } = inputs;
  const n = dates.length;

  const ma200: (number | null)[] = kse100.map((_, i) => {
    if (i + 1 < 200) return null;
    let sum = 0;
    for (let j = i + 1 - 200; j <= i; j++) sum += kse100[j];
    return sum / 200;
  });

  const outcomes = {} as ForecastDataset["outcomes"];
  for (const h of WF_HORIZONS) {
    const ret: (number | null)[] = Array(n).fill(null);
    const min: (number | null)[] = Array(n).fill(null);
    const max: (number | null)[] = Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (i + h >= n || !(kse100[i] > 0)) continue;
      ret[i] = kse100[i + h] / kse100[i] - 1;
      let worst = 0;
      let best = 0;
      for (let j = i + 1; j <= i + h; j++) {
        const move = kse100[j] / kse100[i] - 1;
        if (move < worst) worst = move;
        if (move > best) best = move;
      }
      min[i] = worst;
      max[i] = best;
    }
    outcomes[h] = { ret, min, max };
  }

  return {
    dates,
    close: kse100,
    vol21: realizedVol(kse100, 21),
    adv10: trailingMeanOf(inputs.breadth.advanceShare, 10),
    upvol10: trailingMeanOf(inputs.breadth.upVolumeShare, 10),
    mom21: kse100.map((v, i) => (i < 21 || !(kse100[i - 21] > 0) ? null : v / kse100[i - 21] - 1)),
    ewmaSigma: ewmaSigmaSeries(kse100),
    trendUp: kse100.map((v, i) => (ma200[i] === null ? null : v >= (ma200[i] as number))),
    outcomes,
  };
}

export function directionClass(ret: number, band: number): number {
  if (ret <= -band) return DIR_FALL;
  if (ret >= band) return DIR_RISE;
  return DIR_SIDE;
}

// --- Prediction records --------------------------------------------------------

export interface DirPrediction {
  date: string;
  index: number;
  fold: number;
  horizon: WfHorizon;
  model: string;
  probs: [number, number, number];
  predicted: number;
  actual: number;
  actualReturn: number;
}

export interface RetPrediction {
  date: string;
  index: number;
  fold: number;
  horizon: WfHorizon;
  model: string;
  predicted: number;
  actual: number;
  entryClose: number;
}

export interface RangePrediction {
  date: string;
  index: number;
  fold: number;
  horizon: WfHorizon;
  model: string;
  closeLo: number;
  closeHi: number;
  pathLo: number;
  pathHi: number;
  actualReturn: number;
  actualMin: number;
  actualMax: number;
}

export interface DdPrediction {
  date: string;
  index: number;
  fold: number;
  horizon: WfHorizon;
  model: string;
  threshold: number;
  p: number;
  hit: boolean;
}

export interface WalkForwardRun {
  folds: { fold: number; trainEnd: number; testStart: number; testEnd: number }[];
  direction: DirPrediction[];
  returns: RetPrediction[];
  ranges: RangePrediction[];
  drawdowns: DdPrediction[];
  /** Feature availability window actually used. */
  window: { firstDate: string; lastDate: string; usableRows: number };
}

// --- The run -------------------------------------------------------------------

interface Row {
  index: number;
  features: number[]; // [vol21, adv10, upvol10]
  mom: number;
  sigma: number;
  trendUp: boolean;
}

function usableRows(d: ForecastDataset): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < d.dates.length; i++) {
    const vol = d.vol21[i];
    const adv = d.adv10[i];
    const up = d.upvol10[i];
    const mom = d.mom21[i];
    const sigma = d.ewmaSigma[i];
    const trend = d.trendUp[i];
    if (vol === null || adv === null || up === null || mom === null || sigma === null || trend === null) continue;
    rows.push({ index: i, features: [vol, adv, up], mom, sigma, trendUp: trend });
  }
  return rows;
}

/**
 * Run the full bake-off. Deterministic: same inputs, same output, no random
 * seeds anywhere. Models are refitted from scratch at every fold boundary.
 */
export function runWalkForward(d: ForecastDataset): WalkForwardRun {
  const rows = usableRows(d);
  const maxHorizon = Math.max(...WF_HORIZONS);

  const direction: DirPrediction[] = [];
  const returns: RetPrediction[] = [];
  const ranges: RangePrediction[] = [];
  const drawdowns: DdPrediction[] = [];
  const folds: WalkForwardRun["folds"] = [];

  // Fold boundaries over row positions (not raw indices), stepping monthly.
  let foldNo = 0;
  for (let boundary = MIN_TRAIN_ROWS; boundary < rows.length - 1; boundary += FOLD_STEP) {
    const testRows = rows.slice(boundary, Math.min(boundary + FOLD_STEP, rows.length));
    if (testRows.length === 0) break;
    const boundaryIndex = rows[boundary - 1].index;

    folds.push({
      fold: foldNo,
      trainEnd: boundaryIndex,
      testStart: testRows[0].index,
      testEnd: testRows[testRows.length - 1].index,
    });

    for (const h of WF_HORIZONS) {
      const { ret, min, max } = d.outcomes[h];
      const band = SIDEWAYS_BAND[h];

      // Purge: training outcomes must be fully realised by the boundary.
      const train = rows.slice(0, boundary).filter((r) => r.index + h <= boundaryIndex && ret[r.index] !== null);
      if (train.length < MIN_TRAIN_ROWS - maxHorizon) continue;

      const X = train.map((r) => r.features);
      const yRet = train.map((r) => ret[r.index] as number);
      const yCls = yRet.map((v) => directionClass(v, band));
      const trainSigmaScale = train.map((r) => r.sigma * Math.sqrt(h));

      // Class frequencies for the base-rate forecaster.
      const freq: [number, number, number] = [0, 0, 0];
      for (const c of yCls) freq[c as 0 | 1 | 2]++;
      const baseProbs = freq.map((f) => f / yCls.length) as [number, number, number];
      const baseClass = baseProbs.indexOf(Math.max(...baseProbs));
      const meanRet = yRet.reduce((a, b) => a + b, 0) / yRet.length;

      // Fitted entrants.
      const mnVol = fitMultinomial(train.map((r) => [r.features[0]]), yCls);
      const mnVolBreadth = fitMultinomial(X, yCls);
      const mnRobust = fitMultinomial(train.map((r) => [...r.features, r.mom]), yCls);
      const ridge = fitRidge(X, yRet);
      const analog = fitAnalog(train.map((r) => r.trendUp), train.map((r) => r.features[0]), yRet);

      const sortedRet = [...yRet].sort((a, b) => a - b);
      const volScaledRet = fitVolScaled(yRet, trainSigmaScale);
      const volScaledMin = fitVolScaled(train.map((r) => min[r.index] as number), trainSigmaScale);
      const volScaledMax = fitVolScaled(train.map((r) => max[r.index] as number), trainSigmaScale);
      const qLoModel = fitQuantile(train.map((r) => [r.features[0], r.features[1]]), yRet, 0.1);
      const qHiModel = fitQuantile(train.map((r) => [r.features[0], r.features[1]]), yRet, 0.9);

      const trainMinSorted = train.map((r) => min[r.index] as number).sort((a, b) => a - b);
      const trainMaxSorted = train.map((r) => max[r.index] as number).sort((a, b) => a - b);

      const ddModels: Record<number, { logitVol: ReturnType<typeof fitLogistic>; logitVB: ReturnType<typeof fitLogistic>; stumps: ReturnType<typeof fitStumps>; baseRate: number }> = {};
      for (const t of DRAWDOWN_TARGETS) {
        const yHit: number[] = train.map((r) => ((min[r.index] as number) <= t ? 1 : 0));
        ddModels[t] = {
          logitVol: fitLogistic(train.map((r) => [r.features[0]]), yHit),
          logitVB: fitLogistic(X, yHit),
          stumps: fitStumps(X, yHit),
          baseRate: yHit.reduce((a, b) => a + b, 0) / yHit.length,
        };
      }

      for (const r of testRows) {
        const actualRet = ret[r.index];
        const actualMin = min[r.index];
        const actualMax = max[r.index];
        if (actualRet === null || actualMin === null || actualMax === null) continue;
        const actualCls = directionClass(actualRet, band);
        const sigmaScale = r.sigma * Math.sqrt(h);
        const common = { date: d.dates[r.index], index: r.index, fold: foldNo, horizon: h };

        // --- Direction ---
        const pushDir = (model: string, probs: [number, number, number]) => {
          const predicted = probs.indexOf(Math.max(...probs));
          direction.push({ ...common, model, probs, predicted, actual: actualCls, actualReturn: actualRet });
        };
        pushDir("base-rate", baseProbs);
        pushDir("always-up", [0, 0, 1]);
        pushDir(
          "trend-naive",
          r.trendUp ? [0.1, 0.2, 0.7] : [0.7, 0.2, 0.1]
        );
        pushDir("logit-vol", predictMultinomial(mnVol, [r.features[0]]) as [number, number, number]);
        pushDir("logit-vol-breadth", predictMultinomial(mnVolBreadth, r.features) as [number, number, number]);
        pushDir("robust-plus-momentum", predictMultinomial(mnRobust, [...r.features, r.mom]) as [number, number, number]);
        {
          const sample = analogSample(analog, r.trendUp, r.features[0]);
          const pFall = sample.filter((v) => v <= -band).length / sample.length;
          const pRise = sample.filter((v) => v >= band).length / sample.length;
          pushDir("analog", [pFall, Math.max(0, 1 - pFall - pRise), pRise]);
        }
        void baseClass;

        // --- Expected return ---
        const pushRet = (model: string, predicted: number) =>
          returns.push({ ...common, model, predicted, actual: actualRet, entryClose: d.close[r.index] });
        pushRet("zero", 0);
        pushRet("train-mean", meanRet);
        pushRet("ridge-vol-breadth", predictRidge(ridge, r.features));
        pushRet("analog-median", quantileOf(analogSample(analog, r.trendUp, r.features[0]), 0.5));

        // --- Ranges (10th to 90th) ---
        const pushRange = (model: string, closeLo: number, closeHi: number, pathLo: number, pathHi: number) =>
          ranges.push({ ...common, model, closeLo, closeHi, pathLo, pathHi, actualReturn: actualRet, actualMin, actualMax });
        pushRange(
          "empirical",
          quantileOf(sortedRet, 0.1),
          quantileOf(sortedRet, 0.9),
          quantileOf(trainMinSorted, 0.1),
          quantileOf(trainMaxSorted, 0.9)
        );
        pushRange(
          "vol-scaled",
          volScaledQuantile(volScaledRet, 0.1, sigmaScale),
          volScaledQuantile(volScaledRet, 0.9, sigmaScale),
          volScaledQuantile(volScaledMin, 0.1, sigmaScale),
          volScaledQuantile(volScaledMax, 0.9, sigmaScale)
        );
        {
          const lo = predictQuantile(qLoModel, [r.features[0], r.features[1]]);
          const hi = predictQuantile(qHiModel, [r.features[0], r.features[1]]);
          // A crossed pair is a failed fit for that date; fall back to ordering.
          pushRange(
            "quantile-reg",
            Math.min(lo, hi),
            Math.max(lo, hi),
            volScaledQuantile(volScaledMin, 0.1, sigmaScale),
            volScaledQuantile(volScaledMax, 0.9, sigmaScale)
          );
        }

        // --- Drawdown probabilities ---
        for (const t of DRAWDOWN_TARGETS) {
          const m = ddModels[t];
          const hit = actualMin <= t;
          const pushDd = (model: string, p: number) =>
            drawdowns.push({ ...common, model, threshold: t, p: Math.min(Math.max(p, 0), 1), hit });
          pushDd("base-rate", m.baseRate);
          pushDd("logit-vol", predictLogistic(m.logitVol, [r.features[0]]));
          pushDd("logit-vol-breadth", predictLogistic(m.logitVB, r.features));
          pushDd("stumps", predictStumps(m.stumps, r.features));
          pushDd("vol-scaled-cdf", volScaledCdf(volScaledMin, t, sigmaScale));
        }
      }
    }
    foldNo++;
  }

  return {
    folds,
    direction,
    returns,
    ranges,
    drawdowns,
    window: {
      firstDate: rows.length ? d.dates[rows[0].index] : "",
      lastDate: rows.length ? d.dates[rows[rows.length - 1].index] : "",
      usableRows: rows.length,
    },
  };
}
