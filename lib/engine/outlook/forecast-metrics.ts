import type { DirPrediction, RetPrediction, RangePrediction, DdPrediction, WfHorizon } from "@/lib/engine/outlook/walkforward";

/**
 * Evaluation and gating for the Phase 3 bake-off.
 *
 * Every task is judged against its own naive baseline, on the full test span
 * and on stability splits (halves, years, calm/turbulent), and drawdown skill
 * additionally has to survive removing its single largest episode. The gates
 * are written down here as code, decided before the results were seen; a task
 * that fails ships as withheld, not as a softer claim.
 */

// --- Small helpers -------------------------------------------------------------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** Split any prediction list into halves by date order. */
function halves<T extends { date: string }>(preds: T[]): [T[], T[]] {
  const sorted = [...preds].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  return [sorted.slice(0, mid), sorted.slice(mid)];
}

/** Cluster hit dates into episodes: gaps beyond the horizon start a new one. */
export function episodeClusters(dates: string[], horizonSessions: number): string[][] {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const spanMs = horizonSessions * 1.6 * 86_400_000;
  const clusters: string[][] = [[sorted[0]]];
  let anchor = Date.parse(sorted[0]);
  for (const dt of sorted.slice(1)) {
    const t = Date.parse(dt);
    if (t - anchor > spanMs) {
      clusters.push([dt]);
      anchor = t;
    } else {
      clusters[clusters.length - 1].push(dt);
      anchor = t;
    }
  }
  return clusters;
}

// --- Direction ------------------------------------------------------------------

export interface DirectionMetrics {
  n: number;
  accuracy: number;
  balancedAccuracy: number;
  /** Per class: [fall, sideways, rise]. */
  precision: number[];
  recall: number[];
  confusion: number[][];
}

export function directionMetrics(preds: DirPrediction[]): DirectionMetrics {
  const confusion = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of preds) confusion[p.actual][p.predicted]++;
  const recall = [0, 1, 2].map((c) => {
    const total = confusion[c].reduce((a, b) => a + b, 0);
    return total ? confusion[c][c] / total : NaN;
  });
  const precision = [0, 1, 2].map((c) => {
    const total = confusion[0][c] + confusion[1][c] + confusion[2][c];
    return total ? confusion[c][c] / total : NaN;
  });
  const correct = confusion[0][0] + confusion[1][1] + confusion[2][2];
  const n = preds.length;
  const presentRecalls = recall.filter((r) => Number.isFinite(r));
  return {
    n,
    accuracy: n ? correct / n : NaN,
    balancedAccuracy: presentRecalls.length ? mean(presentRecalls) : NaN,
    precision,
    recall,
    confusion,
  };
}

// --- Expected return -------------------------------------------------------------

export interface ReturnMetrics {
  n: number;
  mae: number;
  medae: number;
  rmse: number;
  directionalAccuracy: number;
  /** Mean absolute error expressed in index points at each entry's level. */
  maePoints: number;
}

export function returnMetrics(preds: RetPrediction[]): ReturnMetrics {
  const errs = preds.map((p) => Math.abs(p.predicted - p.actual));
  const sq = preds.map((p) => (p.predicted - p.actual) ** 2);
  const signMatch = preds.filter((p) => Math.sign(p.predicted) === Math.sign(p.actual) && p.actual !== 0);
  return {
    n: preds.length,
    mae: mean(errs),
    medae: median(errs),
    rmse: Math.sqrt(mean(sq)),
    directionalAccuracy: preds.length ? signMatch.length / preds.length : NaN,
    maePoints: mean(preds.map((p) => Math.abs(p.predicted - p.actual) * p.entryClose)),
  };
}

// --- Ranges ---------------------------------------------------------------------

export interface RangeMetrics {
  n: number;
  closeCoverage: number;
  pathCoverage: number;
  avgCloseWidth: number;
  avgPathWidth: number;
  /** Share of actuals below the lower bound / above the upper (target 0.10 each). */
  belowLo: number;
  aboveHi: number;
  /** Mean interval score at alpha=0.2 (width plus scaled violations); lower is better. */
  intervalScore: number;
}

export function rangeMetrics(preds: RangePrediction[]): RangeMetrics {
  const alpha = 0.2;
  const inClose = preds.filter((p) => p.actualReturn >= p.closeLo && p.actualReturn <= p.closeHi);
  const inPath = preds.filter((p) => p.actualMin >= p.pathLo && p.actualMax <= p.pathHi);
  const below = preds.filter((p) => p.actualReturn < p.closeLo);
  const above = preds.filter((p) => p.actualReturn > p.closeHi);
  const scores = preds.map((p) => {
    let s = p.closeHi - p.closeLo;
    if (p.actualReturn < p.closeLo) s += (2 / alpha) * (p.closeLo - p.actualReturn);
    if (p.actualReturn > p.closeHi) s += (2 / alpha) * (p.actualReturn - p.closeHi);
    return s;
  });
  return {
    n: preds.length,
    closeCoverage: preds.length ? inClose.length / preds.length : NaN,
    pathCoverage: preds.length ? inPath.length / preds.length : NaN,
    avgCloseWidth: mean(preds.map((p) => p.closeHi - p.closeLo)),
    avgPathWidth: mean(preds.map((p) => p.pathHi - p.pathLo)),
    belowLo: preds.length ? below.length / preds.length : NaN,
    aboveHi: preds.length ? above.length / preds.length : NaN,
    intervalScore: mean(scores),
  };
}

// --- Drawdown probabilities -------------------------------------------------------

export interface DdMetrics {
  n: number;
  brier: number;
  /** Skill against the base-rate entrant evaluated on the same predictions. */
  brierSkill: number | null;
  calibration: { bin: string; predicted: number; realized: number; n: number }[];
  maxCalibrationGap: number;
  hitEpisodes: number;
  detectedEpisodes: number;
  falseAlarmsPerYear: number;
  medianAdvanceSessions: number | null;
  /** Skill recomputed with the largest hit episode removed. */
  skillExcludingLargestEpisode: number | null;
}

export function ddMetrics(preds: DdPrediction[], basePreds: DdPrediction[], horizon: WfHorizon): DdMetrics {
  const brierOf = (list: DdPrediction[]) => mean(list.map((p) => (p.p - (p.hit ? 1 : 0)) ** 2));
  const brier = brierOf(preds);
  const baseByDate = new Map(basePreds.map((p) => [p.date, p]));
  const paired = preds.filter((p) => baseByDate.has(p.date));
  const baseBrier = brierOf(paired.map((p) => baseByDate.get(p.date)!));
  const brierSkill = Number.isFinite(baseBrier) && baseBrier > 0 ? 1 - brierOf(paired) / baseBrier : null;

  // Calibration in five bins over predicted probability.
  const bins = [0, 0.1, 0.2, 0.3, 0.5, 1.00001];
  const calibration = bins.slice(0, -1).map((lo, i) => {
    const hi = bins[i + 1];
    const inBin = preds.filter((p) => p.p >= lo && p.p < hi);
    return {
      bin: `${(lo * 100).toFixed(0)}-${(Math.min(hi, 1) * 100).toFixed(0)}%`,
      predicted: mean(inBin.map((p) => p.p)),
      realized: inBin.length ? inBin.filter((p) => p.hit).length / inBin.length : NaN,
      n: inBin.length,
    };
  });
  const maxCalibrationGap = Math.max(
    0,
    ...calibration.filter((c) => c.n >= 25 && Number.isFinite(c.realized)).map((c) => Math.abs(c.predicted - c.realized))
  );

  // Alarms: predicted probability at least 1.5x the base entrant's rate that day.
  const alarmAt = (p: DdPrediction) => {
    const base = baseByDate.get(p.date);
    return base ? p.p >= base.p * 1.5 && p.p >= 0.05 : false;
  };
  const hitDates = preds.filter((p) => p.hit).map((p) => p.date);
  const clusters = episodeClusters(hitDates, horizon);
  const byDate = new Map(preds.map((p) => [p.date, p]));
  const sortedDates = preds
    .map((p) => p.date)
    .sort()
    .filter((v, i, a) => a.indexOf(v) === i);

  let detected = 0;
  const advances: number[] = [];
  for (const cluster of clusters) {
    const start = cluster[0];
    const startPos = sortedDates.indexOf(start);
    // An episode is detected if any session from `horizon` before its start
    // through its start carried an alarm.
    const from = Math.max(0, startPos - horizon);
    let firstAlarmPos: number | null = null;
    for (let i = from; i <= startPos; i++) {
      const pred = byDate.get(sortedDates[i]);
      if (pred && alarmAt(pred)) {
        firstAlarmPos = i;
        break;
      }
    }
    if (firstAlarmPos !== null) {
      detected++;
      advances.push(startPos - firstAlarmPos);
    }
  }

  // False alarms: alarm days whose own window saw no hit, per year of test span.
  const falseAlarms = preds.filter((p) => alarmAt(p) && !p.hit).length;
  const spanYears =
    sortedDates.length > 1 ? (Date.parse(sortedDates[sortedDates.length - 1]) - Date.parse(sortedDates[0])) / (365.25 * 86_400_000) : NaN;

  // Episode dependence: drop the largest hit cluster and re-score.
  let skillExcludingLargestEpisode: number | null = null;
  if (clusters.length > 0 && brierSkill !== null) {
    const largest = new Set(clusters.reduce((a, b) => (a.length >= b.length ? a : b)));
    const kept = paired.filter((p) => !largest.has(p.date));
    const keptBase = kept.map((p) => baseByDate.get(p.date)!);
    const keptBaseBrier = brierOf(keptBase);
    skillExcludingLargestEpisode = Number.isFinite(keptBaseBrier) && keptBaseBrier > 0 ? 1 - brierOf(kept) / keptBaseBrier : null;
  }

  return {
    n: preds.length,
    brier,
    brierSkill,
    calibration,
    maxCalibrationGap,
    hitEpisodes: clusters.length,
    detectedEpisodes: detected,
    falseAlarmsPerYear: Number.isFinite(spanYears) && spanYears > 0 ? falseAlarms / spanYears : NaN,
    medianAdvanceSessions: advances.length ? median(advances) : null,
    skillExcludingLargestEpisode,
  };
}

// --- Stability splits -------------------------------------------------------------

export interface SplitResult<M> {
  full: M;
  firstHalf: M;
  secondHalf: M;
  byYear: { year: string; metrics: M }[];
}

export function splitBy<T extends { date: string }, M>(preds: T[], metric: (list: T[]) => M): SplitResult<M> {
  const [h1, h2] = halves(preds);
  const years = [...new Set(preds.map((p) => yearOf(p.date)))].sort();
  return {
    full: metric(preds),
    firstHalf: metric(h1),
    secondHalf: metric(h2),
    byYear: years.map((year) => ({ year, metrics: metric(preds.filter((p) => yearOf(p.date) === year)) })),
  };
}

// --- Gates -------------------------------------------------------------------------

export interface GateResult {
  pass: boolean;
  reasons: string[];
}

/** Direction: beat both naive baselines on balanced accuracy, in full and both halves. */
export function gateDirection(
  candidate: SplitResult<DirectionMetrics>,
  baselines: { name: string; metrics: SplitResult<DirectionMetrics> }[]
): GateResult {
  const reasons: string[] = [];
  const margin = 0.02;
  for (const b of baselines) {
    if (!(candidate.full.balancedAccuracy > b.metrics.full.balancedAccuracy + margin)) {
      reasons.push(
        `balanced accuracy ${fmt(candidate.full.balancedAccuracy)} does not beat ${b.name} (${fmt(b.metrics.full.balancedAccuracy)}) by ${margin}`
      );
    }
    if (!(candidate.firstHalf.balancedAccuracy > b.metrics.firstHalf.balancedAccuracy)) {
      reasons.push(`loses to ${b.name} in the first half`);
    }
    if (!(candidate.secondHalf.balancedAccuracy > b.metrics.secondHalf.balancedAccuracy)) {
      reasons.push(`loses to ${b.name} in the second half`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

/** Expected return: at least 2% lower MAE than the best naive, in full and both halves. */
export function gateReturn(candidate: SplitResult<ReturnMetrics>, naives: SplitResult<ReturnMetrics>[]): GateResult {
  const reasons: string[] = [];
  const bestFull = Math.min(...naives.map((n) => n.full.mae));
  const bestH1 = Math.min(...naives.map((n) => n.firstHalf.mae));
  const bestH2 = Math.min(...naives.map((n) => n.secondHalf.mae));
  if (!(candidate.full.mae < bestFull * 0.98)) reasons.push(`MAE ${fmtPct(candidate.full.mae)} not 2% under best naive ${fmtPct(bestFull)}`);
  if (!(candidate.firstHalf.mae < bestH1)) reasons.push("loses to a naive forecast in the first half");
  if (!(candidate.secondHalf.mae < bestH2)) reasons.push("loses to a naive forecast in the second half");
  return { pass: reasons.length === 0, reasons };
}

/** Ranges: calibrated coverage in both halves, and a better interval score than the unconditional range. */
export function gateRange(candidate: SplitResult<RangeMetrics>, unconditional: SplitResult<RangeMetrics>): GateResult {
  const reasons: string[] = [];
  for (const [label, m] of [
    ["full sample", candidate.full],
    ["first half", candidate.firstHalf],
    ["second half", candidate.secondHalf],
  ] as const) {
    if (!(m.closeCoverage >= 0.72 && m.closeCoverage <= 0.9)) {
      reasons.push(`close coverage ${fmt(m.closeCoverage)} in the ${label} outside the 72-90% calibration band (target 80%)`);
    }
  }
  if (!(candidate.full.intervalScore < unconditional.full.intervalScore)) {
    reasons.push(
      `interval score ${fmtPct(candidate.full.intervalScore)} does not beat the unconditional range (${fmtPct(unconditional.full.intervalScore)})`
    );
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * Drawdown: material positive skill in full and both halves, sane calibration,
 * survives episode removal, and actually functions as a warning.
 *
 * The last two conditions were added after the first run exposed a degenerate
 * pass: a boosted-stump model that predicted near the base rate everywhere
 * earned an epsilon of Brier skill (0.003), never issued a single alarm, and
 * detected zero of eight episodes — yet cleared a gate that only asked for
 * skill above zero. A warning system that never warns is not a warning system,
 * so the gate now demands material skill and at least one detected episode.
 * The change tightens the bar; nothing that previously failed can now pass.
 */
export function gateDrawdown(candidate: SplitResult<DdMetrics>): GateResult {
  const reasons: string[] = [];
  const MATERIAL_SKILL = 0.02;
  if (!((candidate.full.brierSkill ?? -1) >= MATERIAL_SKILL))
    reasons.push(`Brier skill ${fmt(candidate.full.brierSkill ?? NaN)} below the material floor of ${MATERIAL_SKILL}`);
  if (!((candidate.firstHalf.brierSkill ?? -1) > 0)) reasons.push("no skill in the first half");
  if (!((candidate.secondHalf.brierSkill ?? -1) > 0)) reasons.push("no skill in the second half");
  if (!(candidate.full.maxCalibrationGap < 0.15)) reasons.push(`calibration gap ${fmt(candidate.full.maxCalibrationGap)} exceeds 0.15`);
  if (!((candidate.full.skillExcludingLargestEpisode ?? -1) > 0)) reasons.push("skill disappears when the largest episode is removed");
  if (!(candidate.full.detectedEpisodes >= 1))
    reasons.push(`detected ${candidate.full.detectedEpisodes} of ${candidate.full.hitEpisodes} episodes; a warning that never warns is not shippable`);
  return { pass: reasons.length === 0, reasons };
}

const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "n/a");
const fmtPct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "n/a");
