import type { AlignedInputs } from "@/lib/engine/outlook/inputs";
import { BENCHMARK_SIGNAL_KEY, SIGNALS, SIGNAL_PAIRS, type SignalDef } from "@/lib/engine/outlook/signals";
import { countEpisodes } from "@/lib/engine/outlook/breadth-signal";

/**
 * Phase 2 signal evaluation.
 *
 * Answers one question per signal: did its risky extreme precede 3% and 5%
 * drawdowns over 5, 10 and 20 sessions more often than the base rate, in a way
 * that survives the three standard ways such findings die?
 *
 *  - Overlap inflation: rates are judged on distinct market episodes, not
 *    window counts, since fifty overlapping windows can be one bad month.
 *  - Redundancy: every signal is re-measured inside the calm-volatility third
 *    of history. A signal that only fires when volatility is already high adds
 *    nothing to a model that has volatility.
 *  - Instability: lift is recomputed on the first and second halves of the
 *    sample separately. A signal that inverts between halves is describing a
 *    period, not a mechanism.
 *
 * Discipline notes. States come from EXPANDING percentiles: a value is ranked
 * only against its own past, never the full sample, so the state assigned to a
 * date is exactly what could have been assigned on that date. And nothing here
 * fits anything: every number is a conditional frequency count.
 */

export type SignalClass = "strong" | "moderate" | "weak" | "redundant" | "unstable" | "insufficient";

/** Horizons under evaluation. 1 month never drives a verdict. */
export const EVAL_HORIZONS = [
  { key: "5d", sessions: 5, secondary: false },
  { key: "10d", sessions: 10, secondary: false },
  { key: "20d", sessions: 20, secondary: false },
  { key: "1m", sessions: 21, secondary: true },
] as const;

/** Drawdown targets fixed at the Phase 1 gate. */
export const EVAL_THRESHOLDS = [-0.03, -0.05] as const;

/** Observations of a signal's own history required before states are assigned. */
export const STATE_WARMUP = 252;

// Classification bars, all documented by the reasons they emit.
const MIN_RISKY_WINDOWS = 60;
const MIN_HIT_EPISODES = 3;
const STRONG = { lift: 1.5, episodes: 5, half: 1.2, beyond: 1.25 };
const MODERATE = { lift: 1.25, episodes: 4, half: 1.0, beyond: 1.05 };
const UNSTABLE_HIGH = 1.15;
const UNSTABLE_LOW = 0.9;
const HALF_MIN_RISKY = 30;
const BEYOND_MIN_WINDOWS = 30;
const BEYOND_MIN_EPISODES = 2;

export type PitState = "risky" | "mid" | "safe" | null;

/**
 * Expanding-percentile tercile states. The rank of each value is taken against
 * the signal's own history up to and including that date, with a warmup before
 * any state is assigned. This is what makes every downstream rate honest: the
 * cut-offs a date is judged by existed on that date.
 */
export function pitTercileStates(
  values: (number | null)[],
  riskyDirection: "high" | "low",
  warmup = STATE_WARMUP
): PitState[] {
  const history: number[] = [];
  return values.map((v) => {
    if (v === null) return null;
    // Insert into sorted history; binary search keeps this O(n log n) overall.
    let lo = 0;
    let hi = history.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (history[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    history.splice(lo, 0, v);
    if (history.length < warmup) return null;
    const rank = lo / (history.length - 1 || 1);
    const highTail = rank >= 2 / 3;
    const lowTail = rank <= 1 / 3;
    if (riskyDirection === "high") return highTail ? "risky" : lowTail ? "safe" : "mid";
    return lowTail ? "risky" : highTail ? "safe" : "mid";
  });
}

/** Worst intra-window decline ahead of each date; null where the window runs out. */
export function forwardWorst(closes: number[], sessions: number): (number | null)[] {
  return closes.map((entry, i) => {
    if (!(entry > 0) || i + sessions >= closes.length) return null;
    let worst = 0;
    for (let j = i + 1; j <= i + sessions; j++) {
      const move = closes[j] / entry - 1;
      if (move < worst) worst = move;
    }
    return worst;
  });
}

interface Obs {
  index: number;
  date: string;
  state: Exclude<PitState, null>;
  benchmarkState: PitState;
  hit: boolean;
}

export interface BeyondVol {
  calmWindows: number;
  calmRiskyWindows: number;
  calmBaseRate: number;
  calmRiskyRate: number;
  lift: number | null;
  hitEpisodes: number;
}

export interface CellEvidence {
  horizonKey: string;
  sessions: number;
  secondary: boolean;
  threshold: number;
  n: number;
  riskyWindows: number;
  safeWindows: number;
  baseRate: number;
  riskyRate: number;
  safeRate: number;
  lift: number | null;
  firstHalfLift: number | null;
  secondHalfLift: number | null;
  hits: number;
  hitEpisodes: number;
  beyondVol: BeyondVol | null;
  classification: SignalClass;
  reasons: string[];
}

export interface SignalEvidence {
  key: string;
  family: SignalDef["family"];
  label: string;
  riskyDirection: "high" | "low";
  coverage: { firstDate: string | null; lastDate: string | null; observations: number };
  cells: CellEvidence[];
  verdict: SignalClass;
  verdictReason: string;
}

export interface PairCell {
  horizonKey: string;
  threshold: number;
  anchorSafeOtherSafe: { rate: number; windows: number };
  anchorSafeOtherRisky: { rate: number; windows: number };
  anchorRiskyOtherSafe: { rate: number; windows: number };
  anchorRiskyOtherRisky: { rate: number; windows: number };
  /** Lift of the other signal's risky state inside the anchor's safe third. */
  liftWithinAnchorSafe: number | null;
  hitEpisodes: number;
  quotable: boolean;
}

export interface PairEvidence {
  anchor: string;
  other: string;
  why: string;
  cells: PairCell[];
}

export interface RegimeEvidence {
  key: string;
  label: string;
  occupancyShare: number;
  cells: { horizonKey: string; threshold: number; rate: number; windows: number; hitEpisodes: number }[];
}

export interface SignalEvidenceReport {
  generatedAt: string;
  window: { firstDate: string | null; lastDate: string | null; sessions: number };
  horizons: { key: string; sessions: number; secondary: boolean }[];
  thresholds: number[];
  signals: SignalEvidence[];
  pairs: PairEvidence[];
  regimes: RegimeEvidence[];
  method: string[];
}

const rate = (obs: Obs[]): number => (obs.length ? obs.filter((o) => o.hit).length / obs.length : NaN);

function liftOf(riskyRate: number, baseRate: number): number | null {
  if (!Number.isFinite(riskyRate) || !(baseRate > 0)) return null;
  return riskyRate / baseRate;
}

function classifyCell(cell: Omit<CellEvidence, "classification" | "reasons">, isBenchmark: boolean): { classification: SignalClass; reasons: string[] } {
  const reasons: string[] = [];

  if (cell.riskyWindows < MIN_RISKY_WINDOWS || cell.hitEpisodes < MIN_HIT_EPISODES) {
    reasons.push(
      cell.riskyWindows < MIN_RISKY_WINDOWS
        ? `only ${cell.riskyWindows} risky windows (need ${MIN_RISKY_WINDOWS})`
        : `only ${cell.hitEpisodes} distinct hit episodes (need ${MIN_HIT_EPISODES})`
    );
    return { classification: "insufficient", reasons };
  }

  const h1 = cell.firstHalfLift;
  const h2 = cell.secondHalfLift;
  if (h1 !== null && h2 !== null) {
    const flipped = (h1 >= UNSTABLE_HIGH && h2 <= UNSTABLE_LOW) || (h2 >= UNSTABLE_HIGH && h1 <= UNSTABLE_LOW);
    if (flipped) {
      reasons.push(`lift flips between halves (${h1.toFixed(2)}x then ${h2.toFixed(2)}x)`);
      return { classification: "unstable", reasons };
    }
  } else {
    reasons.push("stability across halves not measurable; capped at moderate");
  }

  const L = cell.lift;
  const beyond = cell.beyondVol;
  const beyondMeasured =
    beyond !== null && beyond.calmRiskyWindows >= BEYOND_MIN_WINDOWS && beyond.hitEpisodes >= BEYOND_MIN_EPISODES;

  if (!isBenchmark && L !== null && L >= MODERATE.lift && beyondMeasured && (beyond.lift ?? 0) < MODERATE.beyond) {
    reasons.push(`lift ${L.toFixed(2)}x overall but ${(beyond.lift ?? 0).toFixed(2)}x within calm volatility; the information is volatility's`);
    return { classification: "redundant", reasons };
  }

  const beyondOk = (bar: number): boolean => {
    if (isBenchmark) return true;
    if (!beyondMeasured) return false;
    return (beyond.lift ?? 0) >= bar;
  };
  const halvesOk = (bar: number): boolean => h1 !== null && h2 !== null && h1 >= bar && h2 >= bar;

  if (L !== null && L >= STRONG.lift && cell.hitEpisodes >= STRONG.episodes && halvesOk(STRONG.half) && beyondOk(STRONG.beyond)) {
    reasons.push(`lift ${L.toFixed(2)}x on ${cell.hitEpisodes} episodes, stable across halves${isBenchmark ? "" : ", adds beyond volatility"}`);
    return { classification: "strong", reasons };
  }
  if (L !== null && L >= MODERATE.lift && cell.hitEpisodes >= MODERATE.episodes && halvesOk(MODERATE.half) && beyondOk(MODERATE.beyond)) {
    reasons.push(`lift ${L.toFixed(2)}x on ${cell.hitEpisodes} episodes, direction holds in both halves`);
    return { classification: "moderate", reasons };
  }

  reasons.push(L === null ? "no measurable lift" : `lift ${L.toFixed(2)}x does not clear the moderate bar with its evidence`);
  return { classification: "weak", reasons };
}

function verdictOf(cells: CellEvidence[]): { verdict: SignalClass; verdictReason: string } {
  const primary = cells.filter((c) => !c.secondary);
  const count = (cls: SignalClass) => primary.filter((c) => c.classification === cls).length;

  if (primary.every((c) => c.classification === "insufficient")) {
    return { verdict: "insufficient", verdictReason: "No primary cell carries enough windows or distinct episodes to judge." };
  }
  if (count("strong") > 0) {
    const best = primary.find((c) => c.classification === "strong")!;
    return { verdict: "strong", verdictReason: `Strong at the ${Math.abs(best.threshold * 100).toFixed(0)}% / ${best.horizonKey} cell: ${best.reasons[best.reasons.length - 1]}.` };
  }
  if (count("moderate") > 0) {
    const best = primary.find((c) => c.classification === "moderate")!;
    return { verdict: "moderate", verdictReason: `Moderate at the ${Math.abs(best.threshold * 100).toFixed(0)}% / ${best.horizonKey} cell: ${best.reasons[best.reasons.length - 1]}.` };
  }
  if (count("unstable") >= 2) {
    return { verdict: "unstable", verdictReason: "Lift inverts between sample halves in two or more primary cells." };
  }
  if (count("redundant") > 0) {
    return { verdict: "redundant", verdictReason: "Lift exists but disappears within calm volatility; the signal restates volatility." };
  }
  return { verdict: "weak", verdictReason: "No primary cell clears the moderate bar." };
}

/** Method notes embedded in the report, so the artifact explains itself. */
const METHOD_NOTES = [
  "States are expanding-percentile terciles over each signal's own history, with a 252-observation warmup; the cut-offs a date is judged by existed on that date.",
  "Non-PSX series (SPY, EEM, gold, USD/PKR) are lagged one session because their daily bar closes after the PKT close. CPI carries a ~35-day publication lag. Flows are lagged one session.",
  "Outcomes are the worst intra-window decline from the entry close, matching the early-warning target.",
  "Distinct episodes collapse runs of overlapping hit windows; classification bars are set on episodes, not windows.",
  "Beyond-volatility lift re-measures each signal inside the calm-volatility third; redundant means the lift lives entirely in turbulent periods.",
  "Stability recomputes lift on each half of the sample; a flip between halves classifies the cell unstable.",
  "Everything here is descriptive and in-sample. No model has been fitted and nothing is a forecast.",
];

export function buildSignalEvidence(inputs: AlignedInputs, asOf = new Date()): SignalEvidenceReport {
  const { dates, kse100 } = inputs;

  // Signal values and states, computed once.
  const valuesByKey = new Map<string, (number | null)[]>();
  const statesByKey = new Map<string, PitState[]>();
  for (const def of SIGNALS) {
    const values = def.compute(inputs);
    valuesByKey.set(def.key, values);
    statesByKey.set(def.key, pitTercileStates(values, def.riskyDirection));
  }
  const benchmarkStates = statesByKey.get(BENCHMARK_SIGNAL_KEY)!;

  // Forward outcomes per horizon, computed once.
  const worstByHorizon = new Map<string, (number | null)[]>();
  for (const h of EVAL_HORIZONS) worstByHorizon.set(h.key, forwardWorst(kse100, h.sessions));

  const signals: SignalEvidence[] = SIGNALS.map((def) => {
    const states = statesByKey.get(def.key)!;
    const isBenchmark = def.key === BENCHMARK_SIGNAL_KEY;
    const covered = dates.filter((_, i) => states[i] !== null);

    const cells: CellEvidence[] = [];
    for (const h of EVAL_HORIZONS) {
      const worst = worstByHorizon.get(h.key)!;
      for (const threshold of EVAL_THRESHOLDS) {
        const obs: Obs[] = [];
        for (let i = 0; i < dates.length; i++) {
          const state = states[i];
          const w = worst[i];
          if (state === null || w === null) continue;
          obs.push({ index: i, date: dates[i], state, benchmarkState: benchmarkStates[i], hit: w <= threshold });
        }

        const risky = obs.filter((o) => o.state === "risky");
        const safe = obs.filter((o) => o.state === "safe");
        const baseRate = rate(obs);
        const riskyRate = rate(risky);
        const hitDates = risky.filter((o) => o.hit).map((o) => o.date);

        const mid = Math.floor(obs.length / 2);
        const halfLift = (half: Obs[]): number | null => {
          const r = half.filter((o) => o.state === "risky");
          if (r.length < HALF_MIN_RISKY) return null;
          return liftOf(rate(r), rate(half));
        };

        let beyondVol: BeyondVol | null = null;
        if (!isBenchmark) {
          const calm = obs.filter((o) => o.benchmarkState === "safe");
          const calmRisky = calm.filter((o) => o.state === "risky");
          const calmHits = calmRisky.filter((o) => o.hit).map((o) => o.date);
          beyondVol = {
            calmWindows: calm.length,
            calmRiskyWindows: calmRisky.length,
            calmBaseRate: rate(calm),
            calmRiskyRate: rate(calmRisky),
            lift: liftOf(rate(calmRisky), rate(calm)),
            hitEpisodes: countEpisodes(calmHits, h.sessions),
          };
        }

        const bare: Omit<CellEvidence, "classification" | "reasons"> = {
          horizonKey: h.key,
          sessions: h.sessions,
          secondary: h.secondary,
          threshold,
          n: obs.length,
          riskyWindows: risky.length,
          safeWindows: safe.length,
          baseRate,
          riskyRate,
          safeRate: rate(safe),
          lift: liftOf(riskyRate, baseRate),
          firstHalfLift: halfLift(obs.slice(0, mid)),
          secondHalfLift: halfLift(obs.slice(mid)),
          hits: hitDates.length,
          hitEpisodes: countEpisodes(hitDates, h.sessions),
          beyondVol,
        };
        cells.push({ ...bare, ...classifyCell(bare, isBenchmark) });
      }
    }

    return {
      key: def.key,
      family: def.family,
      label: def.label,
      riskyDirection: def.riskyDirection,
      coverage: {
        firstDate: covered[0] ?? null,
        lastDate: covered[covered.length - 1] ?? null,
        observations: covered.length,
      },
      cells,
      ...verdictOf(cells),
    };
  });

  // Pairs, judged only at the horizons with real room for a joint read.
  const pairs: PairEvidence[] = SIGNAL_PAIRS.map((pair) => {
    const anchorStates = statesByKey.get(pair.anchor)!;
    const otherStates = statesByKey.get(pair.other)!;
    const cells: PairCell[] = [];
    for (const h of EVAL_HORIZONS.filter((x) => x.key === "10d" || x.key === "20d")) {
      const worst = worstByHorizon.get(h.key)!;
      for (const threshold of EVAL_THRESHOLDS) {
        const groups = { ss: [] as Obs[], sr: [] as Obs[], rs: [] as Obs[], rr: [] as Obs[] };
        for (let i = 0; i < dates.length; i++) {
          const a = anchorStates[i];
          const o = otherStates[i];
          const w = worst[i];
          if (a === null || o === null || w === null || a === "mid" || o === "mid") continue;
          const key = `${a === "safe" ? "s" : "r"}${o === "safe" ? "s" : "r"}` as keyof typeof groups;
          groups[key].push({ index: i, date: dates[i], state: o === "safe" ? "safe" : "risky", benchmarkState: null, hit: w <= threshold });
        }
        const srHits = groups.sr.filter((o) => o.hit).map((o) => o.date);
        const episodes = countEpisodes(srHits, h.sessions);
        cells.push({
          horizonKey: h.key,
          threshold,
          anchorSafeOtherSafe: { rate: rate(groups.ss), windows: groups.ss.length },
          anchorSafeOtherRisky: { rate: rate(groups.sr), windows: groups.sr.length },
          anchorRiskyOtherSafe: { rate: rate(groups.rs), windows: groups.rs.length },
          anchorRiskyOtherRisky: { rate: rate(groups.rr), windows: groups.rr.length },
          liftWithinAnchorSafe: liftOf(rate(groups.sr), rate(groups.ss)),
          hitEpisodes: episodes,
          quotable: episodes >= MIN_HIT_EPISODES,
        });
      }
    }
    return { anchor: pair.anchor, other: pair.other, why: pair.why, cells };
  });

  // Regimes: trend state crossed with the volatility tercile, purely descriptive.
  const trendValues = valuesByKey.get("dist_ma200")!;
  const regimeDefs = [
    { key: "up_calm", label: "Uptrend, calm", trend: "up", vol: "safe" },
    { key: "up_mid", label: "Uptrend, mid volatility", trend: "up", vol: "mid" },
    { key: "up_turbulent", label: "Uptrend, turbulent", trend: "up", vol: "risky" },
    { key: "down_calm", label: "Downtrend, calm", trend: "down", vol: "safe" },
    { key: "down_mid", label: "Downtrend, mid volatility", trend: "down", vol: "mid" },
    { key: "down_turbulent", label: "Downtrend, turbulent", trend: "down", vol: "risky" },
  ] as const;

  const regimeAt: (string | null)[] = dates.map((_, i) => {
    const t = trendValues[i];
    const v = benchmarkStates[i];
    if (t === null || v === null) return null;
    return `${t >= 0 ? "up" : "down"}_${v === "safe" ? "calm" : v === "mid" ? "mid" : "turbulent"}`;
  });
  const occupied = regimeAt.filter((r) => r !== null).length;

  const regimes: RegimeEvidence[] = regimeDefs.map((def) => {
    const key = `${def.trend}_${def.vol === "safe" ? "calm" : def.vol === "mid" ? "mid" : "turbulent"}`;
    const memberIdx = dates.map((_, i) => i).filter((i) => regimeAt[i] === key);
    const cells: RegimeEvidence["cells"] = [];
    for (const h of EVAL_HORIZONS.filter((x) => x.key === "10d" || x.key === "20d")) {
      const worst = worstByHorizon.get(h.key)!;
      for (const threshold of EVAL_THRESHOLDS) {
        const member = memberIdx.filter((i) => worst[i] !== null);
        const hits = member.filter((i) => (worst[i] as number) <= threshold);
        cells.push({
          horizonKey: h.key,
          threshold,
          rate: member.length ? hits.length / member.length : NaN,
          windows: member.length,
          hitEpisodes: countEpisodes(hits.map((i) => dates[i]), h.sessions),
        });
      }
    }
    return {
      key: def.key,
      label: def.label,
      occupancyShare: occupied ? memberIdx.length / occupied : NaN,
      cells,
    };
  });

  return {
    generatedAt: asOf.toISOString(),
    window: { firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null, sessions: dates.length },
    horizons: EVAL_HORIZONS.map((h) => ({ key: h.key, sessions: h.sessions, secondary: h.secondary })),
    thresholds: [...EVAL_THRESHOLDS],
    signals,
    pairs,
    regimes,
    method: METHOD_NOTES,
  };
}
