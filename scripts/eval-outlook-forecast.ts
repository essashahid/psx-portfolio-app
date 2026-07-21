// Phase 3 bake-off for the PSX Market Outlook.
//
// Runs every forecasting entrant through the purged expanding walk-forward,
// scores each task against its naive baseline, applies the ship/withhold
// gates, validates support levels and sector sensitivities, reconstructs what
// the selected models would have said at a few historical dates, and builds
// one current experimental outlook from whatever passed.
//
//   npx tsx scripts/eval-outlook-forecast.ts            # print report
//   npx tsx scripts/eval-outlook-forecast.ts --write    # also write the artifacts

import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadAlignedInputs } from "@/lib/engine/outlook/inputs";
import {
  buildForecastDataset,
  runWalkForward,
  WF_HORIZONS,
  DRAWDOWN_TARGETS,
  type WfHorizon,
  type WalkForwardRun,
} from "@/lib/engine/outlook/walkforward";
import {
  directionMetrics,
  returnMetrics,
  rangeMetrics,
  ddMetrics,
  splitBy,
  gateDirection,
  gateReturn,
  gateRange,
  gateDrawdown,
  type SplitResult,
  type DirectionMetrics,
  type ReturnMetrics,
  type RangeMetrics,
  type DdMetrics,
} from "@/lib/engine/outlook/forecast-metrics";
import { buildExperimentalOutlook, type GateDecision } from "@/lib/engine/outlook/experimental-outlook";
import { studySupportLevels, technicalStructureAt, type Bar } from "@/lib/engine/outlook/technical-structure";
import { loadSectorPanel, buildFactorConditions, validateSectorImpacts } from "@/lib/engine/outlook/sector-impact";
import { pitTercileStates } from "@/lib/engine/outlook/evaluate";

config({ path: resolve(process.cwd(), ".env.local") });

const pct = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");
const num = (v: number | null | undefined, d = 3) => (v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(d) : "n/a");

/** Simplicity order per task: the first passing candidate wins. */
const DIRECTION_CANDIDATES = ["logit-vol", "logit-vol-breadth", "analog", "robust-plus-momentum"];
const RETURN_CANDIDATES = ["ridge-vol-breadth", "analog-median"];
const RANGE_CANDIDATES = ["vol-scaled", "quantile-reg"];
const DD_CANDIDATES = ["vol-scaled-cdf", "logit-vol", "logit-vol-breadth", "stumps"];

async function main() {
  const write = process.argv.includes("--write");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log("Loading inputs...");
  const inputs = await loadAlignedInputs(supabase);
  const dataset = buildForecastDataset(inputs);
  console.log(`Sessions: ${dataset.dates.length} (${dataset.dates[0]} -> ${dataset.dates[dataset.dates.length - 1]})`);

  console.log("Running walk-forward (all tasks, all entrants)...");
  const run: WalkForwardRun = runWalkForward(dataset);
  console.log(`Folds: ${run.folds.length}. Test window ${dataset.dates[run.folds[0].testStart]} -> ${dataset.dates[run.folds[run.folds.length - 1].testEnd]}`);

  // Regime tags (calm/mid/turbulent) for slicing, point-in-time by construction.
  const volStates = pitTercileStates(dataset.vol21, "high");
  const regimeOf = new Map<string, string>();
  dataset.dates.forEach((date, i) => {
    const s = volStates[i];
    regimeOf.set(date, s === "safe" ? "calm" : s === "risky" ? "turbulent" : s === "mid" ? "mid" : "unknown");
  });

  const gates: GateDecision[] = [];
  interface TaskEval {
    task: string;
    horizon: WfHorizon;
    threshold?: number;
    models: Record<string, unknown>;
    selected: string | null;
    pass: boolean;
    reasons: string[];
  }
  const evaluations: TaskEval[] = [];

  const regimeSlice = <T extends { date: string }>(preds: T[], regime: string) => preds.filter((p) => regimeOf.get(p.date) === regime);

  for (const h of WF_HORIZONS) {
    // ---------- Direction ----------
    {
      const preds = run.direction.filter((p) => p.horizon === h);
      const byModel = (m: string) => preds.filter((p) => p.model === m);
      const metricsFor = (m: string) => splitBy(byModel(m), directionMetrics);
      const all: Record<string, SplitResult<DirectionMetrics> & { calm?: DirectionMetrics; turbulent?: DirectionMetrics }> = {};
      for (const m of new Set(preds.map((p) => p.model))) {
        all[m] = {
          ...metricsFor(m),
          calm: directionMetrics(regimeSlice(byModel(m), "calm")),
          turbulent: directionMetrics(regimeSlice(byModel(m), "turbulent")),
        };
      }
      const baselines = [
        { name: "always-up", metrics: all["always-up"] },
        { name: "base-rate", metrics: all["base-rate"] },
        { name: "trend-naive", metrics: all["trend-naive"] },
      ];
      let selected: string | null = null;
      let reasons: string[] = [];
      for (const candidate of DIRECTION_CANDIDATES) {
        const gate = gateDirection(all[candidate], baselines.slice(0, 2));
        if (gate.pass) {
          selected = candidate;
          reasons = [];
          break;
        }
        reasons.push(`${candidate}: ${gate.reasons[0] ?? "failed"}`);
      }
      gates.push({ task: "direction", horizon: h, pass: selected !== null, selectedModel: selected, reasons });
      evaluations.push({ task: "direction", horizon: h, models: all, selected, pass: selected !== null, reasons });
    }

    // ---------- Expected return ----------
    {
      const preds = run.returns.filter((p) => p.horizon === h);
      const byModel = (m: string) => splitBy(preds.filter((p) => p.model === m), returnMetrics);
      const all: Record<string, SplitResult<ReturnMetrics>> = {};
      for (const m of new Set(preds.map((p) => p.model))) all[m] = byModel(m);
      const naives = [all["zero"], all["train-mean"]];
      let selected: string | null = null;
      let reasons: string[] = [];
      for (const candidate of RETURN_CANDIDATES) {
        const gate = gateReturn(all[candidate], naives);
        if (gate.pass) {
          selected = candidate;
          reasons = [];
          break;
        }
        reasons.push(`${candidate}: ${gate.reasons[0] ?? "failed"}`);
      }
      gates.push({ task: "return", horizon: h, pass: selected !== null, selectedModel: selected, reasons });
      evaluations.push({ task: "return", horizon: h, models: all, selected, pass: selected !== null, reasons });
    }

    // ---------- Ranges ----------
    {
      const preds = run.ranges.filter((p) => p.horizon === h);
      const byModel = (m: string) => splitBy(preds.filter((p) => p.model === m), rangeMetrics);
      const all: Record<string, SplitResult<RangeMetrics>> = {};
      for (const m of new Set(preds.map((p) => p.model))) all[m] = byModel(m);
      let selected: string | null = null;
      let reasons: string[] = [];
      for (const candidate of RANGE_CANDIDATES) {
        const gate = gateRange(all[candidate], all["empirical"]);
        if (gate.pass) {
          selected = candidate;
          reasons = [];
          break;
        }
        reasons.push(`${candidate}: ${gate.reasons[0] ?? "failed"}`);
      }
      gates.push({ task: "closing-range", horizon: h, pass: selected !== null, selectedModel: selected, reasons });
      evaluations.push({ task: "closing-range", horizon: h, models: all, selected, pass: selected !== null, reasons });

      // Trading range: judged on path coverage of the same candidates.
      const pathOk = (m: string) => {
        const s = all[m];
        return [s.full, s.firstHalf, s.secondHalf].every((x) => x.pathCoverage >= 0.72 && x.pathCoverage <= 0.95);
      };
      const pathSelected = selected !== null && pathOk(selected) ? selected : RANGE_CANDIDATES.find(pathOk) ?? null;
      gates.push({
        task: "trading-range",
        horizon: h,
        pass: pathSelected !== null,
        selectedModel: pathSelected,
        reasons: pathSelected ? [] : ["trading-range coverage outside the 72-95% calibration band in at least one half"],
      });
      evaluations.push({
        task: "trading-range",
        horizon: h,
        models: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { pathCoverage: v.full.pathCoverage, avgPathWidth: v.full.avgPathWidth }])),
        selected: pathSelected,
        pass: pathSelected !== null,
        reasons: [],
      });
    }

    // ---------- Drawdowns ----------
    for (const t of DRAWDOWN_TARGETS) {
      const preds = run.drawdowns.filter((p) => p.horizon === h && p.threshold === t);
      const basePreds = preds.filter((p) => p.model === "base-rate");
      const metricsFor = (m: string) => splitBy(preds.filter((p) => p.model === m), (list) => ddMetrics(list, basePreds, h));
      const all: Record<string, SplitResult<DdMetrics> & { calm?: DdMetrics; turbulent?: DdMetrics }> = {};
      for (const m of new Set(preds.map((p) => p.model))) {
        const base = metricsFor(m);
        all[m] = {
          ...base,
          calm: ddMetrics(regimeSlice(preds.filter((p) => p.model === m), "calm"), basePreds, h),
          turbulent: ddMetrics(regimeSlice(preds.filter((p) => p.model === m), "turbulent"), basePreds, h),
        };
      }
      let selected: string | null = null;
      let reasons: string[] = [];
      for (const candidate of DD_CANDIDATES) {
        const gate = gateDrawdown(all[candidate]);
        if (gate.pass) {
          selected = candidate;
          reasons = [];
          break;
        }
        reasons.push(`${candidate}: ${gate.reasons[0] ?? "failed"}`);
      }
      gates.push({ task: "drawdown", horizon: h, threshold: t, pass: selected !== null, selectedModel: selected, reasons });
      evaluations.push({ task: "drawdown", horizon: h, threshold: t, models: all, selected, pass: selected !== null, reasons });
    }
  }

  // ---------- Support-level study ----------
  console.log("Studying support levels...");
  const bars: Bar[] = dataset.dates.map((date, i) => ({ date, close: dataset.close[i], volume: inputs.kse100Volume[i] }));
  const levelStudy = studySupportLevels(bars, { step: 2 });

  // ---------- Sector validation ----------
  console.log("Validating sector sensitivities (loads the constituent panel)...");
  const panel = await loadSectorPanel(supabase, dataset.dates);
  const sectorResults = validateSectorImpacts(panel, buildFactorConditions(inputs));

  // ---------- Historical examples ----------
  const h20 = dataset.outcomes[20];
  const testStartIndex = run.folds[0].testStart;
  const evaluable = dataset.dates
    .map((_, i) => i)
    .filter((i) => i >= testStartIndex && h20.ret[i] !== null && run.drawdowns.some((p) => p.index === i));
  const pick = (score: (i: number) => number) => evaluable.reduce((best, i) => (score(i) > score(best) ? i : best), evaluable[0]);
  const exampleIndices = [
    { label: "Worst month that followed", index: pick((i) => -(h20.ret[i] as number)) },
    { label: "Strongest month that followed", index: pick((i) => h20.ret[i] as number) },
    { label: "Quietest month that followed", index: pick((i) => -Math.abs(h20.ret[i] as number)) },
    { label: "Most recent fully-resolved date", index: evaluable[evaluable.length - 1] },
  ];
  // Examples show what the PASSING outputs would have said at each date, so a
  // reader compares real deliverables against what followed, not withheld ones.
  const examples = exampleIndices.map(({ label, index }) => {
    const date = dataset.dates[index];
    const tech = technicalStructureAt(bars, index);
    const findPred = <T extends { index: number; horizon: WfHorizon; model: string }>(
      list: T[],
      task: GateDecision["task"],
      horizon: WfHorizon,
      threshold?: number
    ): T | undefined => {
      const gate = gates.find((g) => g.task === task && g.horizon === horizon && (threshold === undefined || g.threshold === threshold));
      if (!gate?.pass || !gate.selectedModel) return undefined;
      return list.find(
        (p) =>
          p.index === index &&
          p.horizon === horizon &&
          p.model === gate.selectedModel &&
          (threshold === undefined || (p as unknown as { threshold?: number }).threshold === threshold)
      );
    };
    const dd = findPred(run.drawdowns, "drawdown", 5, -0.03);
    const dir = findPred(run.direction, "direction", 10);
    const path = findPred(run.ranges, "trading-range", 10);
    return {
      label,
      date,
      close: dataset.close[index],
      saidThen: {
        drawdownRisk5d3pct: dd ? { p: dd.p, model: dd.model } : null,
        direction10d: dir ? { fall: dir.probs[0], sideways: dir.probs[1], rise: dir.probs[2], model: dir.model } : null,
        tradingRange10d: path ? { loPct: path.pathLo, hiPct: path.pathHi, model: path.model } : null,
        nearestSupport: tech?.supports[0]?.price ?? null,
        nearestResistance: tech?.resistances[0]?.price ?? null,
        trend: tech?.trend ?? "unknown",
      },
      whatHappened: {
        ret5: dataset.outcomes[5].ret[index],
        ret10: dataset.outcomes[10].ret[index],
        ret20: dataset.outcomes[20].ret[index],
        maxDip10: dataset.outcomes[10].min[index],
        maxRise10: dataset.outcomes[10].max[index],
      },
    };
  });

  // ---------- Current experimental outlook ----------
  const outlook = buildExperimentalOutlook(dataset, gates);

  // ---------- Report ----------
  console.log("\n" + "=".repeat(96));
  console.log("PHASE 3 WALK-FORWARD RESULTS");
  console.log("=".repeat(96));

  for (const h of WF_HORIZONS) {
    console.log(`\n--- ${h} sessions ---`);
    const dir = evaluations.find((e) => e.task === "direction" && e.horizon === h)!;
    const dirModels = dir.models as Record<string, SplitResult<DirectionMetrics>>;
    console.log(`  DIRECTION  ${dir.pass ? `PASS -> ${dir.selected}` : "WITHHELD"}`);
    for (const [m, s] of Object.entries(dirModels)) {
      console.log(
        `    ${m.padEnd(22)} balAcc ${num(s.full.balancedAccuracy)}  acc ${num(s.full.accuracy)}  halves ${num(s.firstHalf.balancedAccuracy)}/${num(s.secondHalf.balancedAccuracy)}`
      );
    }
    const ret = evaluations.find((e) => e.task === "return" && e.horizon === h)!;
    const retModels = ret.models as Record<string, SplitResult<ReturnMetrics>>;
    console.log(`  RETURN     ${ret.pass ? `PASS -> ${ret.selected}` : "WITHHELD"}`);
    for (const [m, s] of Object.entries(retModels)) {
      console.log(`    ${m.padEnd(22)} MAE ${pct(s.full.mae)}  MedAE ${pct(s.full.medae)}  RMSE ${pct(s.full.rmse)}  dirAcc ${num(s.full.directionalAccuracy)}  MAEpts ${num(s.full.maePoints, 0)}`);
    }
    const rng = evaluations.find((e) => e.task === "closing-range" && e.horizon === h)!;
    const rngModels = rng.models as Record<string, SplitResult<RangeMetrics>>;
    console.log(`  CLOSE RANGE ${rng.pass ? `PASS -> ${rng.selected}` : "WITHHELD"}`);
    for (const [m, s] of Object.entries(rngModels)) {
      console.log(
        `    ${m.padEnd(22)} cover ${pct(s.full.closeCoverage)} (halves ${pct(s.firstHalf.closeCoverage)}/${pct(s.secondHalf.closeCoverage)})  width ${pct(s.full.avgCloseWidth)}  IS ${pct(s.full.intervalScore)}  path ${pct(s.full.pathCoverage)}`
      );
    }
    for (const t of DRAWDOWN_TARGETS) {
      const dd = evaluations.find((e) => e.task === "drawdown" && e.horizon === h && e.threshold === t)!;
      const ddModels = dd.models as Record<string, SplitResult<DdMetrics> & { calm?: DdMetrics; turbulent?: DdMetrics }>;
      console.log(`  DRAWDOWN ${Math.abs(t * 100).toFixed(0)}%  ${dd.pass ? `PASS -> ${dd.selected}` : "WITHHELD"}`);
      for (const [m, s] of Object.entries(ddModels)) {
        if (m === "base-rate") continue;
        console.log(
          `    ${m.padEnd(22)} skill ${num(s.full.brierSkill ?? NaN)} (halves ${num(s.firstHalf.brierSkill ?? NaN)}/${num(s.secondHalf.brierSkill ?? NaN)}, ex-episode ${num(s.full.skillExcludingLargestEpisode ?? NaN)})  calGap ${num(s.full.maxCalibrationGap)}  det ${s.full.detectedEpisodes}/${s.full.hitEpisodes}  FA/yr ${num(s.full.falseAlarmsPerYear, 1)}  lead ${s.full.medianAdvanceSessions ?? "n/a"}`
        );
      }
    }
  }

  console.log("\n--- SUPPORT-LEVEL STUDY ---");
  console.log(
    `  approaches ${levelStudy.approaches}, held ${pct(levelStudy.holdRate)}; placebo ${pct(levelStudy.placeboHoldRate)} over ${levelStudy.placeboApproaches}; edge ${pct(levelStudy.edge)}`
  );

  console.log("\n--- SECTOR VALIDATION (validated factor count per sector) ---");
  for (const s of sectorResults.slice(0, 12)) {
    const v = s.factors.filter((f) => f.validated);
    console.log(`  ${s.sector.padEnd(30)} members ${String(s.members).padStart(3)}  validated ${v.length}/${s.factors.length}: ${v.map((f) => f.factor).join(", ") || "none"}`);
  }

  console.log("\n--- GATE SUMMARY ---");
  for (const g of gates) {
    const label = `${g.task}${g.threshold !== undefined ? ` ${Math.abs(g.threshold * 100).toFixed(0)}%` : ""} @ ${g.horizon}d`;
    console.log(`  ${label.padEnd(26)} ${g.pass ? `PASS (${g.selectedModel})` : `WITHHELD — ${g.reasons[0] ?? ""}`}`);
  }

  if (write) {
    const evaluation = {
      generatedAt: new Date().toISOString(),
      window: run.window,
      folds: run.folds.length,
      sidewaysBands: { 5: 0.01, 10: 0.015, 20: 0.025 },
      evaluations,
      gates,
      levelStudy,
      sectors: sectorResults,
      examples,
      notes: [
        "Expanding walk-forward with per-horizon purging; every prediction used only data available at its date.",
        "All lag rules from Phase 2 preserved (non-PSX series one session, CPI ~35 days, flows one session).",
        "Gates were fixed in code before results were inspected; withheld means failed its naive baseline, not unreported.",
      ],
    };
    writeFileSync(resolve(process.cwd(), "data/outlook-phase3-evaluation.json"), JSON.stringify(evaluation, null, 2));
    writeFileSync(resolve(process.cwd(), "data/outlook-experimental.json"), JSON.stringify(outlook, null, 2));
    console.log("\nWrote data/outlook-phase3-evaluation.json and data/outlook-experimental.json");
  } else {
    console.log("\nRe-run with --write to save the artifacts.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
