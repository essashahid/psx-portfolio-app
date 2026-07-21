/**
 * Model library for the Phase 3 bake-off.
 *
 * Every entrant is implemented here, dependency-free, in a form small enough
 * to audit line by line. That is a deliberate trade against sophistication:
 * with ~1,000 usable observations, the models that could not be written this
 * way are the ones that should not be trusted on this data anyway.
 *
 * Nothing in this file touches dates or the database. Models see numeric
 * matrices the walk-forward harness hands them, already purged and lagged, and
 * return numbers. Standardisation constants are learned from the training
 * fold only and applied to test rows.
 */

// --- Shared arithmetic --------------------------------------------------------

export interface Standardizer {
  means: number[];
  sds: number[];
}

export function fitStandardizer(X: number[][]): Standardizer {
  const cols = X[0]?.length ?? 0;
  const means = Array(cols).fill(0);
  const sds = Array(cols).fill(1);
  for (let j = 0; j < cols; j++) {
    let sum = 0;
    for (const row of X) sum += row[j];
    means[j] = sum / X.length;
    let ss = 0;
    for (const row of X) ss += (row[j] - means[j]) ** 2;
    const sd = Math.sqrt(ss / Math.max(1, X.length - 1));
    sds[j] = sd > 1e-12 ? sd : 1;
  }
  return { means, sds };
}

export function applyStandardizer(z: Standardizer, row: number[]): number[] {
  return row.map((v, j) => (v - z.means[j]) / z.sds[j]);
}

/** Solve Ax = b by Gaussian elimination with partial pivoting. Small systems only. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    if (Math.abs(p) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

export function quantileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// --- Ridge regression ---------------------------------------------------------

export interface RidgeModel {
  z: Standardizer;
  intercept: number;
  coefs: number[];
}

/** Closed-form ridge on standardised features. The intercept is unpenalised. */
export function fitRidge(X: number[][], y: number[], lambda = 1): RidgeModel {
  const z = fitStandardizer(X);
  const Xs = X.map((row) => applyStandardizer(z, row));
  const n = Xs.length;
  const p = Xs[0]?.length ?? 0;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const yc = y.map((v) => v - yMean);

  // (X'X + λI) β = X'y over centred/standardised data.
  const A: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const b: number[] = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += Xs[i][j] * yc[i];
      for (let k = j; k < p; k++) A[j][k] += Xs[i][j] * Xs[i][k];
    }
  }
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) A[j][k] = A[k][j];
    A[j][j] += lambda;
  }
  const coefs = p > 0 ? solveLinear(A, b) : [];
  return { z, intercept: yMean, coefs };
}

export function predictRidge(m: RidgeModel, row: number[]): number {
  const s = applyStandardizer(m.z, row);
  return m.intercept + s.reduce((acc, v, j) => acc + v * m.coefs[j], 0);
}

// --- Binary logistic ----------------------------------------------------------

export interface LogisticModel {
  z: Standardizer;
  intercept: number;
  coefs: number[];
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

/** L2-regularised logistic by plain gradient descent. Deterministic. */
export function fitLogistic(X: number[][], y: number[], lambda = 1, iters = 400, lr = 0.1): LogisticModel {
  const z = fitStandardizer(X);
  const Xs = X.map((row) => applyStandardizer(z, row));
  const n = Xs.length;
  const p = Xs[0]?.length ?? 0;
  let intercept = 0;
  const coefs = Array(p).fill(0);

  for (let it = 0; it < iters; it++) {
    let gInt = 0;
    const g = Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const pred = sigmoid(intercept + Xs[i].reduce((acc, v, j) => acc + v * coefs[j], 0));
      const err = pred - y[i];
      gInt += err;
      for (let j = 0; j < p; j++) g[j] += err * Xs[i][j];
    }
    intercept -= (lr * gInt) / n;
    for (let j = 0; j < p; j++) coefs[j] -= lr * (g[j] / n + (lambda * coefs[j]) / n);
  }
  return { z, intercept, coefs };
}

export function predictLogistic(m: LogisticModel, row: number[]): number {
  const s = applyStandardizer(m.z, row);
  return sigmoid(m.intercept + s.reduce((acc, v, j) => acc + v * m.coefs[j], 0));
}

// --- Multinomial logistic (three classes) --------------------------------------

export interface MultinomialModel {
  z: Standardizer;
  /** One (intercept, coefs) per class; softmax across classes. */
  intercepts: number[];
  coefs: number[][];
  classes: number;
}

export function fitMultinomial(X: number[][], y: number[], classes = 3, lambda = 1, iters = 400, lr = 0.1): MultinomialModel {
  const z = fitStandardizer(X);
  const Xs = X.map((row) => applyStandardizer(z, row));
  const n = Xs.length;
  const p = Xs[0]?.length ?? 0;
  const intercepts = Array(classes).fill(0);
  const coefs = Array.from({ length: classes }, () => Array(p).fill(0));

  const probsFor = (row: number[]): number[] => {
    const logits = intercepts.map((b, c) => b + row.reduce((acc, v, j) => acc + v * coefs[c][j], 0));
    const max = Math.max(...logits);
    const exps = logits.map((v) => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((v) => v / sum);
  };

  for (let it = 0; it < iters; it++) {
    const gInt = Array(classes).fill(0);
    const g = Array.from({ length: classes }, () => Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      const pr = probsFor(Xs[i]);
      for (let c = 0; c < classes; c++) {
        const err = pr[c] - (y[i] === c ? 1 : 0);
        gInt[c] += err;
        for (let j = 0; j < p; j++) g[c][j] += err * Xs[i][j];
      }
    }
    for (let c = 0; c < classes; c++) {
      intercepts[c] -= (lr * gInt[c]) / n;
      for (let j = 0; j < p; j++) coefs[c][j] -= lr * (g[c][j] / n + (lambda * coefs[c][j]) / n);
    }
  }
  return { z, intercepts, coefs, classes };
}

export function predictMultinomial(m: MultinomialModel, row: number[]): number[] {
  const s = applyStandardizer(m.z, row);
  const logits = m.intercepts.map((b, c) => b + s.reduce((acc, v, j) => acc + v * m.coefs[c][j], 0));
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

// --- Linear quantile model ------------------------------------------------------

export interface QuantileModel {
  z: Standardizer;
  tau: number;
  intercept: number;
  coefs: number[];
}

/** Pinball-loss subgradient descent, initialised at the unconditional quantile. */
export function fitQuantile(X: number[][], y: number[], tau: number, iters = 600, lr = 0.05): QuantileModel {
  const z = fitStandardizer(X);
  const Xs = X.map((row) => applyStandardizer(z, row));
  const n = Xs.length;
  const p = Xs[0]?.length ?? 0;
  let intercept = quantileOf([...y].sort((a, b) => a - b), tau);
  const coefs = Array(p).fill(0);

  for (let it = 0; it < iters; it++) {
    let gInt = 0;
    const g = Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const pred = intercept + Xs[i].reduce((acc, v, j) => acc + v * coefs[j], 0);
      // d(pinball)/d(pred): -tau below the data point, (1-tau) above it.
      const grad = y[i] >= pred ? -tau : 1 - tau;
      gInt += grad;
      for (let j = 0; j < p; j++) g[j] += grad * Xs[i][j];
    }
    // Step scaled to the target's magnitude so convergence does not depend on units.
    const scale = lr * (Math.abs(intercept) > 1e-9 ? Math.abs(intercept) : 0.01);
    intercept -= (scale * gInt) / n;
    for (let j = 0; j < p; j++) coefs[j] -= (scale * g[j]) / n;
  }
  return { z, tau, intercept, coefs };
}

export function predictQuantile(m: QuantileModel, row: number[]): number {
  const s = applyStandardizer(m.z, row);
  return m.intercept + s.reduce((acc, v, j) => acc + v * m.coefs[j], 0);
}

// --- Volatility-scaled empirical distribution -----------------------------------

export interface VolScaledDistribution {
  /** Sorted standardised outcomes (outcome / entry-vol scale). */
  standardized: number[];
}

/**
 * The workhorse for ranges and break probabilities. Training outcomes are
 * divided by the volatility prevailing at their entry date; forecasting
 * multiplies the standardised quantiles back up by today's volatility. All the
 * conditioning is in the volatility forecast, which is the one thing Phase 2
 * showed to be reliably forecastable.
 */
export function fitVolScaled(outcomes: number[], entryVolScale: number[]): VolScaledDistribution {
  const standardized: number[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const s = entryVolScale[i];
    if (Number.isFinite(outcomes[i]) && s > 1e-9) standardized.push(outcomes[i] / s);
  }
  standardized.sort((a, b) => a - b);
  return { standardized };
}

export function volScaledQuantile(d: VolScaledDistribution, p: number, currentVolScale: number): number {
  return quantileOf(d.standardized, p) * currentVolScale;
}

/** P(outcome <= x) under the scaled distribution. Used for break probabilities. */
export function volScaledCdf(d: VolScaledDistribution, x: number, currentVolScale: number): number {
  if (d.standardized.length === 0 || !(currentVolScale > 1e-9)) return NaN;
  const target = x / currentVolScale;
  let lo = 0;
  let hi = d.standardized.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d.standardized[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo / d.standardized.length;
}

// --- Regime analog model ---------------------------------------------------------

export interface AnalogModel {
  /** Train-window volatility tercile cut-offs. */
  volCuts: { low: number; high: number };
  /** Forward-return samples per regime key. */
  samples: Map<string, number[]>;
  fallback: number[];
}

export function analogRegimeKey(trendUp: boolean, vol: number, cuts: { low: number; high: number }): string {
  const volBand = vol <= cuts.low ? "calm" : vol >= cuts.high ? "turbulent" : "mid";
  return `${trendUp ? "up" : "down"}_${volBand}`;
}

/** Historical analogs: the empirical forward-return distribution of similar past states. */
export function fitAnalog(trendUp: boolean[], vol: number[], outcomes: number[]): AnalogModel {
  const sortedVol = [...vol].sort((a, b) => a - b);
  const cuts = { low: quantileOf(sortedVol, 1 / 3), high: quantileOf(sortedVol, 2 / 3) };
  const samples = new Map<string, number[]>();
  const fallback: number[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    if (!Number.isFinite(outcomes[i])) continue;
    const key = analogRegimeKey(trendUp[i], vol[i], cuts);
    if (!samples.has(key)) samples.set(key, []);
    samples.get(key)!.push(outcomes[i]);
    fallback.push(outcomes[i]);
  }
  for (const list of samples.values()) list.sort((a, b) => a - b);
  fallback.sort((a, b) => a - b);
  return { volCuts: cuts, samples, fallback };
}

/** Analog sample for the current state; falls back when the regime is thin. */
export function analogSample(m: AnalogModel, trendUp: boolean, vol: number, minSamples = 40): number[] {
  const key = analogRegimeKey(trendUp, vol, m.volCuts);
  const list = m.samples.get(key) ?? [];
  return list.length >= minSamples ? list : m.fallback;
}

// --- Boosted stumps (complexity comparison only) ----------------------------------

export interface StumpEnsemble {
  z: Standardizer;
  base: number; // log-odds prior
  stumps: { feature: number; threshold: number; left: number; right: number }[];
}

/**
 * Gradient-boosted depth-one trees on log-loss. Included so the bake-off can
 * show what buying complexity purchases here, not because it is expected to
 * win: with a handful of features and ~1,000 rows, its job is to be beaten.
 */
export function fitStumps(X: number[][], y: number[], rounds = 30, lr = 0.1): StumpEnsemble {
  const z = fitStandardizer(X);
  const Xs = X.map((row) => applyStandardizer(z, row));
  const n = Xs.length;
  const p = Xs[0]?.length ?? 0;
  const posRate = Math.min(Math.max(y.reduce((a, b) => a + b, 0) / n, 1e-6), 1 - 1e-6);
  const base = Math.log(posRate / (1 - posRate));
  const logits = Array(n).fill(base);
  const stumps: StumpEnsemble["stumps"] = [];

  for (let r = 0; r < rounds; r++) {
    const residuals = logits.map((l, i) => y[i] - sigmoid(l));
    let best: { feature: number; threshold: number; left: number; right: number; gain: number } | null = null;

    for (let j = 0; j < p; j++) {
      // Candidate thresholds at feature deciles, deterministic.
      const values = Xs.map((row) => row[j]).sort((a, b) => a - b);
      for (let d = 1; d < 10; d++) {
        const threshold = quantileOf(values, d / 10);
        let sumL = 0;
        let nL = 0;
        let sumR = 0;
        let nR = 0;
        for (let i = 0; i < n; i++) {
          if (Xs[i][j] <= threshold) {
            sumL += residuals[i];
            nL++;
          } else {
            sumR += residuals[i];
            nR++;
          }
        }
        if (nL < 20 || nR < 20) continue;
        const left = sumL / nL;
        const right = sumR / nR;
        const gain = nL * left * left + nR * right * right;
        if (!best || gain > best.gain) best = { feature: j, threshold, left, right, gain };
      }
    }
    if (!best) break;
    stumps.push({ feature: best.feature, threshold: best.threshold, left: best.left, right: best.right });
    for (let i = 0; i < n; i++) {
      logits[i] += lr * (Xs[i][best.feature] <= best.threshold ? best.left : best.right);
    }
  }
  return { z, base, stumps };
}

export function predictStumps(m: StumpEnsemble, row: number[], lr = 0.1): number {
  const s = applyStandardizer(m.z, row);
  let logit = m.base;
  for (const st of m.stumps) logit += lr * (s[st.feature] <= st.threshold ? st.left : st.right);
  return sigmoid(logit);
}
