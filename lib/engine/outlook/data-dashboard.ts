import type { SeriesCoverage, MissingSource, OutlookCoverageReport } from "@/lib/engine/outlook/coverage";
import type { SignalEvidenceReport, SignalClass, CellEvidence } from "@/lib/engine/outlook/evaluate";
import type { HorizonStat, VolConditionalStat } from "@/lib/engine/outlook/history-stats";

/**
 * View model for the outlook research dashboard.
 *
 * Type-only imports throughout, so the interactive sections can import the
 * sentence builders without dragging server code into the client bundle.
 *
 * Nothing here computes a finding. It rearranges the coverage and evidence
 * reports into what the page shows and writes the plain-language takeaways
 * deterministically from those numbers, so the prose can never drift from the
 * table it sits under.
 */

// --- Signals ------------------------------------------------------------------

/** One cell of a signal's evidence, trimmed for the client. */
export interface CompactCell {
  horizonKey: string;
  threshold: number;
  secondary: boolean;
  baseRate: number;
  riskyRate: number;
  lift: number | null;
  hitEpisodes: number;
  firstHalfLift: number | null;
  secondHalfLift: number | null;
  beyondVolLift: number | null;
  beyondVolEpisodes: number | null;
  classification: SignalClass;
}

export interface SignalRow {
  key: string;
  label: string;
  family: string;
  verdict: SignalClass;
  verdictReason: string;
  observations: number;
  firstDate: string | null;
  lastDate: string | null;
  /** The primary cell the verdict rests on, surfaced without expanding. */
  defining: CompactCell | null;
  cells: CompactCell[];
  /** Whether this signal is a candidate for Phase 3. */
  carriedForward: boolean;
}

const CARRIED: SignalClass[] = ["strong", "moderate"];

const VERDICT_ORDER: SignalClass[] = ["strong", "moderate", "redundant", "unstable", "weak", "insufficient"];

function compact(cell: CellEvidence): CompactCell {
  return {
    horizonKey: cell.horizonKey,
    threshold: cell.threshold,
    secondary: cell.secondary,
    baseRate: cell.baseRate,
    riskyRate: cell.riskyRate,
    lift: cell.lift,
    hitEpisodes: cell.hitEpisodes,
    firstHalfLift: cell.firstHalfLift,
    secondHalfLift: cell.secondHalfLift,
    beyondVolLift: cell.beyondVol?.lift ?? null,
    beyondVolEpisodes: cell.beyondVol?.hitEpisodes ?? null,
    classification: cell.classification,
  };
}

// --- Coverage -----------------------------------------------------------------

export type CoverageTier = "ready" | "limited" | "absent";

export interface CoverageGroup {
  tier: CoverageTier;
  title: string;
  blurb: string;
  series: {
    key: string;
    label: string;
    years: number;
    rows: number;
    quality: string;
    note: string;
    lastDate: string | null;
    ageDays: number | null;
  }[];
  /** Only populated for the absent tier. */
  missing: MissingSource[];
}

function tierOf(s: SeriesCoverage): CoverageTier {
  if (s.quality === "missing") return "absent";
  return s.modelReady ? "ready" : "limited";
}

// --- Interactive section inputs ------------------------------------------------

export interface RegimeOption {
  key: string;
  label: string;
  occupancyShare: number;
  cells: { horizonKey: string; threshold: number; rate: number; windows: number; hitEpisodes: number }[];
}

export interface HorizonOption {
  key: string;
  label: string;
  sessions: number;
  independentWindows: number;
  positiveRate: number;
  worstDrawdown: number;
  bestRunup: number;
  returnPercentiles: HorizonStat["returnPercentiles"];
  thresholds: { threshold: number; frequency: number; hits: number }[];
  rallyThresholds: { threshold: number; frequency: number; hits: number }[];
}

export interface TurbulenceOption {
  horizonKey: string;
  threshold: number;
  baseRate: number;
  calmRate: number;
  turbulentRate: number;
  lift: number;
}

// --- The dashboard ------------------------------------------------------------

export interface DashboardSummary {
  signalsTested: number;
  carriedForward: number;
  strong: number;
  moderate: number;
  notCarried: number;
  primarySignal: { label: string; detail: string } | null;
  readiness: { level: "ready" | "marginal" | "not-ready"; headline: string; detail: string };
  evidenceWindow: { firstDate: string | null; lastDate: string | null; sessions: number };
}

export interface DataDashboard {
  summary: DashboardSummary;
  signals: SignalRow[];
  coverage: CoverageGroup[];
  regimes: RegimeOption[];
  horizons: HorizonOption[];
  turbulence: TurbulenceOption[];
  /** Horizon keys present in the regime cells, for the selector. */
  regimeHorizons: string[];
  thresholds: number[];
  method: string[];
  generatedAt: string;
}

const pctText = (v: number, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "an unmeasurable share");

function buildSummary(evidence: SignalEvidenceReport, signals: SignalRow[]): DashboardSummary {
  const strong = signals.filter((s) => s.verdict === "strong");
  const moderate = signals.filter((s) => s.verdict === "moderate");
  const carried = strong.length + moderate.length;

  const primary = strong[0] ?? moderate[0] ?? null;
  const cell = primary?.defining ?? null;

  const readiness: DashboardSummary["readiness"] =
    strong.length > 0
      ? {
          level: "ready",
          headline: "Ready for Phase 3, with a narrow target",
          detail:
            "At least one signal clears the strong bar on distinct episodes and holds its direction across both halves of the sample. That is enough to justify building and validating a model, provided the target stays where the evidence is rather than where the original ambition was.",
        }
      : moderate.length > 0
        ? {
            level: "marginal",
            headline: "Marginal. No signal clears the strong bar",
            detail:
              "Only moderate signals survived. A model could be attempted, but the expectation of finding real out-of-sample skill should be low, and the walk-forward gate is likely to withhold it.",
          }
        : {
            level: "not-ready",
            headline: "Not ready. No signal survived",
            detail:
              "Nothing cleared the moderate bar once episodes, stability and redundancy against volatility were accounted for. Building a model on this evidence would not be defensible.",
          };

  return {
    signalsTested: signals.length,
    carriedForward: carried,
    strong: strong.length,
    moderate: moderate.length,
    notCarried: signals.length - carried,
    primarySignal: primary
      ? {
          label: primary.label,
          detail: cell
            ? `Fell ${Math.abs(cell.threshold * 100).toFixed(0)}% or more in ${pctText(cell.riskyRate)} of periods after its risky readings, against ${pctText(cell.baseRate)} across all periods, over ${cell.horizonKey} on ${cell.hitEpisodes} distinct episodes.`
            : "No defining cell available.",
        }
      : null,
    readiness,
    evidenceWindow: evidence.window,
  };
}

export function buildDataDashboard(
  coverage: OutlookCoverageReport,
  evidence: SignalEvidenceReport
): DataDashboard {
  const signals: SignalRow[] = evidence.signals
    .map((s) => {
      const cells = s.cells.map(compact);
      const primaryCells = cells.filter((c) => !c.secondary);
      const defining = primaryCells.find((c) => c.classification === s.verdict) ?? primaryCells[0] ?? null;
      return {
        key: s.key,
        label: s.label,
        family: s.family,
        verdict: s.verdict,
        verdictReason: s.verdictReason,
        observations: s.coverage.observations,
        firstDate: s.coverage.firstDate,
        lastDate: s.coverage.lastDate,
        defining,
        cells,
        carriedForward: CARRIED.includes(s.verdict),
      };
    })
    .sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.label.localeCompare(b.label));

  const asCoverageSeries = (s: SeriesCoverage) => ({
    key: s.key,
    label: s.label,
    years: s.years,
    rows: s.rows,
    quality: s.quality,
    note: s.note,
    lastDate: s.lastDate,
    ageDays: s.ageDays,
  });

  const coverageGroups: CoverageGroup[] = [
    {
      tier: "ready",
      title: "Ready for modelling",
      blurb: "Three or more years of regular history, current, and computed rather than hand-maintained. These can teach a model what past conditions led to.",
      series: coverage.series.filter((s) => tierOf(s) === "ready").map(asCoverageSeries),
      missing: [],
    },
    {
      tier: "limited",
      title: "Limited or manually maintained",
      blurb: "Usable for describing conditions today, but too short, too sparse or too dependent on manual updating to train on. A stale entry here is a maintenance task, not a data gap.",
      series: coverage.series.filter((s) => tierOf(s) === "limited").map(asCoverageSeries),
      missing: [],
    },
    {
      tier: "absent",
      title: "Missing",
      blurb: "Sources that would improve a forecast and are not available. An absent series is invisible in any report that only lists what exists, so they are named here.",
      series: coverage.series.filter((s) => tierOf(s) === "absent").map(asCoverageSeries),
      missing: coverage.missing,
    },
  ];

  const horizons: HorizonOption[] = coverage.horizons.map((h: HorizonStat) => ({
    key: h.key,
    label: h.label,
    sessions: h.sessions,
    independentWindows: h.independentWindows,
    positiveRate: h.positiveRate,
    worstDrawdown: h.drawdownPercentiles.worst,
    bestRunup: h.runupPercentiles?.best ?? NaN,
    returnPercentiles: h.returnPercentiles,
    thresholds: h.thresholds.map((t) => ({ threshold: t.threshold, frequency: t.frequency, hits: t.hits })),
    rallyThresholds: (h.rallyThresholds ?? []).map((t) => ({ threshold: t.threshold, frequency: t.frequency, hits: t.hits })),
  }));

  const turbulence: TurbulenceOption[] = coverage.volConditional.map((v: VolConditionalStat) => ({
    horizonKey: v.horizonKey,
    threshold: v.threshold,
    baseRate: v.baseRate,
    calmRate: v.lowVolRate,
    turbulentRate: v.highVolRate,
    lift: v.lift,
  }));

  const regimeHorizons = [...new Set(evidence.regimes.flatMap((r) => r.cells.map((c) => c.horizonKey)))];

  return {
    summary: buildSummary(evidence, signals),
    signals,
    coverage: coverageGroups,
    regimes: evidence.regimes.map((r) => ({
      key: r.key,
      label: r.label,
      occupancyShare: r.occupancyShare,
      cells: r.cells,
    })),
    horizons,
    turbulence,
    regimeHorizons,
    thresholds: evidence.thresholds,
    method: evidence.method,
    generatedAt: evidence.generatedAt,
  };
}

// --- Deterministic takeaways ---------------------------------------------------
//
// Written from the same numbers the section displays, so the sentence and the
// figure beside it can never disagree.

const horizonWords: Record<string, string> = {
  "5d": "the following week",
  "10d": "the following two weeks",
  "20d": "the following month",
  "1m": "the following month",
  "3m": "the following three months",
};

export function horizonPhrase(key: string): string {
  return horizonWords[key] ?? `the following ${key}`;
}

/** Takeaway for a regime at a chosen horizon and depth. */
export function regimeTakeaway(
  regime: RegimeOption,
  cell: RegimeOption["cells"][number] | undefined,
  allRegimes: RegimeOption[]
): string {
  if (!cell || !Number.isFinite(cell.rate)) {
    return "This combination did not occur often enough in the past five years to describe.";
  }
  const depth = Math.abs(cell.threshold * 100).toFixed(0);
  const peers = allRegimes
    .map((r) => r.cells.find((c) => c.horizonKey === cell.horizonKey && c.threshold === cell.threshold))
    .filter((c): c is RegimeOption["cells"][number] => !!c && Number.isFinite(c.rate));
  const average = peers.length ? peers.reduce((a, c) => a + c.rate, 0) / peers.length : NaN;

  const comparison = Number.isFinite(average)
    ? cell.rate > average * 1.15
      ? "noticeably more often than in the average state"
      : cell.rate < average * 0.85
        ? "less often than in the average state"
        : "at about the same rate as the average state"
    : "";

  const thin = cell.hitEpisodes < 3 ? ` Only ${cell.hitEpisodes} distinct episode${cell.hitEpisodes === 1 ? "" : "s"} sit behind this, so read it as an illustration rather than a rate.` : "";

  return `The market spent ${pctText(regime.occupancyShare)} of the past five years in this state. When it did, it fell ${depth}% or more at some point during ${horizonPhrase(cell.horizonKey)} in ${pctText(cell.rate)} of periods, ${comparison}.${thin}`;
}

/** Takeaway for a horizon at a chosen depth. */
export function horizonTakeaway(horizon: HorizonOption, threshold: number): string {
  const fell = horizon.thresholds.find((t) => t.threshold === threshold);
  const rose = horizon.rallyThresholds.find((t) => t.threshold === Math.abs(threshold));
  const depth = Math.abs(threshold * 100).toFixed(0);

  if (!fell) {
    return `A fall of ${depth}% over ${horizon.label.toLowerCase()} happened too rarely in this history to quote as a rate.`;
  }

  // The fall and rise figures are intra-period extremes while the finishing
  // figure is close-to-close, which is why they can all be high at once. Say
  // that rather than inferring how many dips recovered: that would need the
  // joint distribution, which is not measured here.
  const both = rose
    ? ` Over the same window it rose ${depth}% or more at some point in ${pctText(rose.frequency)} of periods. The two are measured at the extremes reached inside the period, so a single period can appear in both.`
    : "";

  return `Over ${horizon.label.toLowerCase()}, the market fell ${depth}% or more at some point in ${pctText(fell.frequency)} of periods, and finished higher than it started in ${pctText(horizon.positiveRate)} of them.${both} This rests on ${horizon.independentWindows} independent periods.`;
}

/** Takeaway for the turbulence comparison at a chosen horizon and depth. */
export function turbulenceTakeaway(row: TurbulenceOption | undefined): string {
  if (!row || !Number.isFinite(row.baseRate)) {
    return "There is not enough history at this combination to compare calm and turbulent stretches.";
  }
  const depth = Math.abs(row.threshold * 100).toFixed(0);

  if (row.calmRate === 0) {
    return `A fall of ${depth}% never followed a calm stretch in this history. After a turbulent one it happened in ${pctText(row.turbulentRate)} of periods.`;
  }
  if (!Number.isFinite(row.lift)) {
    return `A fall of ${depth}% followed turbulent stretches in ${pctText(row.turbulentRate)} of periods and calm ones in ${pctText(row.calmRate)}.`;
  }
  if (row.lift >= 1.25) {
    return `Recent turbulence mattered here. A ${depth}% fall followed turbulent stretches in ${pctText(row.turbulentRate)} of periods against ${pctText(row.calmRate)} after calm ones, which is ${row.lift.toFixed(1)} times the overall rate.`;
  }
  if (row.lift <= 0.8) {
    return `The pattern runs backwards at this depth: a ${depth}% fall followed calm stretches slightly more often (${pctText(row.calmRate)}) than turbulent ones (${pctText(row.turbulentRate)}), a sign the signal does not hold everywhere.`;
  }
  return `Turbulence made little difference at this depth: ${pctText(row.turbulentRate)} of turbulent stretches were followed by a ${depth}% fall against ${pctText(row.calmRate)} of calm ones.`;
}
