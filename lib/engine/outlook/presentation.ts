import type { OutlookCoverageReport } from "@/lib/engine/outlook/coverage";
import type { HorizonKey, HorizonStat, VolConditionalStat } from "@/lib/engine/outlook/history-stats";

/**
 * Turns the raw coverage report into what the Outlook tab actually renders.
 *
 * Kept apart from the statistics so the editorial decisions live in one place:
 * which horizons a non-specialist is shown, when a sample is too thin to quote,
 * and how a raw count becomes a plain-language confidence label. It also keeps
 * the client payload small, since the full report carries fifteen series and
 * every gap record that only the data view needs.
 */

/**
 * Horizons offered in the main view.
 *
 * Two of the five computed horizons are deliberately absent. The 20-session
 * window is within a rounding error of the 21-session one (38.0% against 38.2%
 * at the 3% threshold), so offering both invites a comparison that carries no
 * information. The 63-session window is excluded because Phase 1 found no
 * volatility signal there at all and only 19 independent samples behind it;
 * its figures remain on the data view, with that finding stated.
 */
export const MAIN_VIEW_HORIZONS: HorizonKey[] = ["5d", "10d", "1m"];

/**
 * Occurrences required before a drawdown threshold is quoted as a rate.
 * A 10% fall inside five sessions has happened about once in this history, and
 * "0.1%" reads as a measured frequency when it is really a single episode.
 */
export const MIN_EVENTS_TO_QUOTE = 5;

/** Threshold used for the headline number. Available at every offered horizon. */
export const HEADLINE_THRESHOLD = -0.05;

export type ConfidenceLevel = "strong" | "moderate" | "limited";

export interface Confidence {
  level: ConfidenceLevel;
  label: string;
  /** Maps to the Badge variants already used across the platform. */
  variant: "green" | "amber" | "red";
}

/**
 * Independent (non-overlapping) windows behind a horizon, expressed in words.
 * Overlapping windows are not used here: they reuse the same market episodes,
 * so they would inflate every horizon to a confident-looking four figures.
 */
export function confidenceFor(independentWindows: number): Confidence {
  if (independentWindows >= 100) return { level: "strong", label: "Strong evidence", variant: "green" };
  if (independentWindows >= 30) return { level: "moderate", label: "Moderate evidence", variant: "amber" };
  return { level: "limited", label: "Limited evidence", variant: "red" };
}

/** Plain-language naming for each offered horizon. */
const HORIZON_COPY: Record<string, { short: string; forward: string }> = {
  "5d": { short: "1 week", forward: "in the next week" },
  "10d": { short: "2 weeks", forward: "in the next two weeks" },
  "20d": { short: "20 sessions", forward: "in the next 20 sessions" },
  "1m": { short: "1 month", forward: "in the next month" },
  "3m": { short: "3 months", forward: "in the next three months" },
};

export interface ThresholdView {
  /** Negative fraction, e.g. -0.05. */
  threshold: number;
  /** Whole-percent magnitude for labels, e.g. 5. */
  pct: number;
  /** Share of windows reaching it, 0-1. */
  frequency: number;
  hits: number;
}

export interface HorizonView {
  key: HorizonKey;
  /** Toggle label, e.g. "1 month". */
  short: string;
  /** Sentence fragment, e.g. "in the next month". */
  forward: string;
  sessions: number;
  confidence: Confidence;
  independentWindows: number;
  /** Thresholds with enough occurrences to quote, deepest decline last. */
  thresholds: ThresholdView[];
  /** Chance of the headline decline, 0-1. Null when too thin to quote. */
  headlineFrequency: number | null;
  positiveRate: number;
  worstDrawdown: number;
  returnPercentiles: HorizonStat["returnPercentiles"];
}

export interface TurbulenceView {
  horizonKey: HorizonKey;
  threshold: number;
  pct: number;
  baseRate: number;
  calmRate: number;
  turbulentRate: number;
  lift: number;
  /** How the comparison should be described, given the direction and size of the effect. */
  verdict: "raises-risk" | "little-difference" | "lowers-risk";
}

export interface OutlookViewModel {
  horizons: HorizonView[];
  turbulence: TurbulenceView[];
  evidence: {
    sessions: number;
    firstDate: string | null;
    lastDate: string | null;
    years: number;
  } | null;
  generatedAt: string;
}

function classifyLift(lift: number): TurbulenceView["verdict"] {
  if (!Number.isFinite(lift)) return "little-difference";
  if (lift >= 1.25) return "raises-risk";
  if (lift <= 0.8) return "lowers-risk";
  return "little-difference";
}

function toHorizonView(stat: HorizonStat): HorizonView {
  const copy = HORIZON_COPY[stat.key] ?? { short: stat.label, forward: `over ${stat.label}` };
  const thresholds: ThresholdView[] = stat.thresholds
    .filter((t) => t.hits >= MIN_EVENTS_TO_QUOTE)
    .map((t) => ({
      threshold: t.threshold,
      pct: Math.round(Math.abs(t.threshold * 100)),
      frequency: t.frequency,
      hits: t.hits,
    }));
  const headline = thresholds.find((t) => t.threshold === HEADLINE_THRESHOLD) ?? null;

  return {
    key: stat.key,
    short: copy.short,
    forward: copy.forward,
    sessions: stat.sessions,
    confidence: confidenceFor(stat.independentWindows),
    independentWindows: stat.independentWindows,
    thresholds,
    headlineFrequency: headline ? headline.frequency : null,
    positiveRate: stat.positiveRate,
    worstDrawdown: stat.drawdownPercentiles.worst,
    returnPercentiles: stat.returnPercentiles,
  };
}

function toTurbulenceView(stat: VolConditionalStat): TurbulenceView {
  return {
    horizonKey: stat.horizonKey,
    threshold: stat.threshold,
    pct: Math.round(Math.abs(stat.threshold * 100)),
    baseRate: stat.baseRate,
    calmRate: stat.lowVolRate,
    turbulentRate: stat.highVolRate,
    lift: stat.lift,
    verdict: classifyLift(stat.lift),
  };
}

export function buildOutlookViewModel(report: OutlookCoverageReport): OutlookViewModel {
  const wanted = new Set<string>(MAIN_VIEW_HORIZONS);
  const horizons = report.horizons
    .filter((h) => wanted.has(h.key))
    .sort((a, b) => a.sessions - b.sessions)
    .map(toHorizonView);

  const quotable = new Map(horizons.map((h) => [h.key, new Set(h.thresholds.map((t) => t.threshold))]));
  const turbulence = report.volConditional
    .filter((v) => quotable.get(v.horizonKey)?.has(v.threshold) ?? false)
    .map(toTurbulenceView);

  return {
    horizons,
    turbulence,
    evidence: report.index
      ? {
          sessions: report.index.points,
          firstDate: report.index.firstDate,
          lastDate: report.index.lastDate,
          years: report.index.years,
        }
      : null,
    generatedAt: report.generatedAt,
  };
}

/**
 * Shared scale for the range indicator, so switching horizon visibly widens the
 * band instead of re-fitting the axis under it and appearing not to move.
 */
export function returnDomain(horizons: HorizonView[]): { min: number; max: number } {
  if (horizons.length === 0) return { min: -0.1, max: 0.1 };
  const lows = horizons.map((h) => h.returnPercentiles.p10);
  const highs = horizons.map((h) => h.returnPercentiles.p90);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = Math.max((max - min) * 0.15, 0.01);
  return { min: min - pad, max: max + pad };
}
