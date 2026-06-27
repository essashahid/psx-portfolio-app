import { ASSET_CLASSES, ASSET_LABEL, type AssetClass, type Allocation, type MixOutcome, type MonthlyReturns, type AssetEstimate, type ReturnModel } from "./types";
import { buildReturnModel } from "./returns";
import { optimizeAllocation, evaluateMix, riskParityMix } from "./optimizer";
import { scoreRegimes, regimeTilt, type RegimeScore } from "./regimes";
import { gatherSignals, type SignalReading, type SignalInputs } from "./signals";
import { deriveEventsFromNews, eventRegimeContributions, type EventSignal, type NewsCategoryCounts } from "./events";
import { stressMix, type StressResult } from "./stress";
import { runBacktest, type BacktestResult } from "./backtest";
import {
  BENCHMARK_60_20_20,
  BENCHMARK_EQUAL,
  BENCHMARK_EQUITY,
  OBJECTIVE_LABEL,
  HORIZON_YEARS,
} from "./objective";
import type { MacroQuality } from "./data";

export * from "./types";

/** A probability-weighted scenario: a macro regime and the mix it implies. */
export interface Scenario {
  regimeId: string;
  label: string;
  thesis: string;
  /** Probability of the REGIME (not of the allocation succeeding). */
  probability: number;
  mix: MixOutcome;
  stress: StressResult[];
  /** Top signals pushing this regime, for transparency. */
  drivers: { label: string; value: number; reliability: string }[];
}

export type ConfidenceLevel = "high" | "moderate" | "low" | "insufficient";

export interface ConfidenceComponent {
  id: string;
  label: string;
  level: ConfidenceLevel;
  detail: string;
}

export interface Confidence {
  overall: ConfidenceLevel;
  components: ConfidenceComponent[];
}

export interface DeploymentItem {
  asset: AssetClass;
  label: string;
  currentWeight: number;
  targetWeight: number;
  buyPkr: number;
}

export interface Recommendation {
  withheld: boolean;
  /** Why a single recommendation was withheld (when withheld). */
  withheldReason?: string;
  regimeId?: string;
  label?: string;
  allocation?: Allocation;
  outcome?: MixOutcome;
  deployFirst?: AssetClass;
  deployment?: DeploymentItem[];
}

export interface AllocationForecast {
  generatedAt: string;
  objective: string;
  horizonYears: number;
  window: { firstMonth: string | null; lastMonth: string | null; months: number };
  estimates: Record<AssetClass, AssetEstimate>;
  scenarios: Scenario[];
  recommendation: Recommendation;
  benchmarks: { sixtyTwentyTwenty: MixOutcome; equalWeight: MixOutcome; allEquity: MixOutcome; riskParity: Allocation };
  signals: SignalReading[];
  events: EventSignal[];
  confidence: Confidence;
  backtest: BacktestResult;
  dataQuality: MacroQuality;
  /** Filled in by narrate.ts; never originates numbers. */
  narrative?: AllocationNarrative;
}

export interface AllocationNarrative {
  summary: string;
  scenarioNotes: Record<string, string>;
  recommendationNote: string;
  eventsNote: string;
  model: string;
}

export interface BuildForecastInput {
  series: MonthlyReturns[];
  signalInputs: Omit<SignalInputs, "series" | "globalRiskBias"> & { newsCounts?: NewsCategoryCounts | null };
  dataQuality: MacroQuality;
  monthsByAsset: { equity: number; gold: number; btc: number };
  assetFirstMonths: { equity: string | null; gold: string | null; btc: string | null };
  /** Current portfolio weights across the four classes (null = fresh capital). */
  current?: Allocation | null;
  portfolioValuePkr?: number;
  investableCashPkr?: number;
}

const MIN_BACKTEST_OBS = 18;
const MIN_WINDOW_MONTHS = 24;

function levelFromMonths(months: number): ConfidenceLevel {
  if (months >= 48) return "high";
  if (months >= 36) return "moderate";
  if (months >= MIN_WINDOW_MONTHS) return "low";
  return "insufficient";
}

const RANK: Record<ConfidenceLevel, number> = { high: 3, moderate: 2, low: 1, insufficient: 0 };
const weakest = (levels: ConfidenceLevel[]): ConfidenceLevel =>
  levels.reduce((acc, l) => (RANK[l] < RANK[acc] ? l : acc), "high");

function topDrivers(regimeId: string, signals: SignalReading[]): Scenario["drivers"] {
  // Surface the strongest-magnitude signals as the human-readable drivers.
  return [...signals]
    .filter((s) => s.reliability !== "unavailable" && Math.abs(s.value) > 0.15)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((s) => ({ label: s.label, value: s.value, reliability: s.reliability }));
}

function deployFirstAsset(target: Allocation, current: Allocation): AssetClass {
  let best: AssetClass = "equity";
  let bestGap = -Infinity;
  for (const a of ASSET_CLASSES) {
    const gap = target[a] - current[a];
    if (gap > bestGap) {
      bestGap = gap;
      best = a;
    }
  }
  return best;
}

function deploymentPlan(target: Allocation, current: Allocation, portfolioValue: number, cash: number): DeploymentItem[] {
  const totalAfter = portfolioValue + cash;
  // Buy-side gaps, scaled to the available cash so the plan is fundable.
  const gaps = ASSET_CLASSES.map((a) => ({ a, buy: Math.max(0, target[a] * totalAfter - current[a] * portfolioValue) }));
  const totalBuy = gaps.reduce((s, g) => s + g.buy, 0);
  const scale = totalBuy > cash && totalBuy > 0 ? cash / totalBuy : 1;
  return ASSET_CLASSES.map((a) => {
    const g = gaps.find((x) => x.a === a)!;
    return { asset: a, label: ASSET_LABEL[a], currentWeight: current[a], targetWeight: target[a], buyPkr: g.buy * scale };
  });
}

/** Assemble the full forecast from a loaded return series and signal inputs. */
export function buildForecast(input: BuildForecastInput): AllocationForecast {
  const { series } = input;
  const model: ReturnModel = buildReturnModel(series);

  // --- Signals + structured events ---
  const events = deriveEventsFromNews(input.signalInputs.newsCounts ?? null);
  const eventContribs = eventRegimeContributions(events);
  const globalRiskBias = events.length
    ? Math.min(1, events.reduce((s, e) => s + (e.type === "imf_program" ? -e.magnitude : e.magnitude), 0) / events.length)
    : null;
  const signals = gatherSignals({
    series,
    usdpkr: input.signalInputs.usdpkr,
    tbillYieldPct: input.signalInputs.tbillYieldPct,
    foreignFlowBias: input.signalInputs.foreignFlowBias ?? null,
    globalRiskBias,
  });

  // --- Regimes -> probability-weighted scenarios with distinct mixes ---
  const regimeScores: RegimeScore[] = scoreRegimes(signals, eventContribs);
  const current = input.current ?? null;
  const scenarios: Scenario[] = regimeScores.map((r) => {
    const override: Partial<Record<AssetClass, number>> = {};
    for (const a of ASSET_CLASSES) override[a] = model.estimates[a].expReturn + (regimeTilt(r.id)[a] ?? 0);
    const mix = optimizeAllocation(model, { current, expReturnOverride: override });
    return {
      regimeId: r.id,
      label: r.label,
      thesis: r.thesis,
      probability: r.probability,
      mix,
      stress: stressMix(mix.allocation),
      drivers: topDrivers(r.id, signals),
    };
  });

  // --- Backtest (layered) ---
  const backtest = runBacktest(series, input.assetFirstMonths);

  // --- Confidence (component-wise, gated by the weakest important component) ---
  const components: ConfidenceComponent[] = [];
  const coreLevel = levelFromMonths(series.length);
  components.push({ id: "core_history", label: "Core price history", level: coreLevel, detail: `${series.length} aligned monthly observations (${input.assetFirstMonths.equity ?? "?"} onward).` });
  const btcLevel = levelFromMonths(input.monthsByAsset.btc);
  components.push({ id: "btc_history", label: "Bitcoin history", level: btcLevel, detail: `${input.monthsByAsset.btc} months of BTC data.` });
  const dqMissing = input.dataQuality.equity === "missing" || input.dataQuality.gold === "missing" || input.dataQuality.btc === "missing";
  const dqStale = input.dataQuality.equity === "stale" || input.dataQuality.gold === "stale" || input.dataQuality.btc === "stale";
  const dqLevel: ConfidenceLevel = dqMissing ? "insufficient" : dqStale ? "low" : "high";
  components.push({ id: "data_freshness", label: "Data freshness", level: dqLevel, detail: dqMissing ? "A priced asset is missing data." : dqStale ? "Some series are stale." : "All series current." });
  const btLevel: ConfidenceLevel = backtest.core.observations >= MIN_BACKTEST_OBS ? (backtest.enhancedAddsValue ? "moderate" : "low") : "insufficient";
  components.push({ id: "backtest", label: "Out-of-sample backtest", level: btLevel, detail: `${backtest.core.observations} walk-forward observations; regime overlay ${backtest.enhancedAddsValue ? "added" : "did not clearly add"} value.` });
  if (input.signalInputs.foreignFlowBias != null) {
    components.push({ id: "flow_signal", label: "Foreign-flow signal", level: "low", detail: "Short out-of-sample history; influence capped at 5pp on any regime." });
  }

  const overall = weakest([coreLevel, dqLevel, btLevel]);

  // --- Recommendation (or withhold below the evidence bar) ---
  const lead = scenarios[0];
  let recommendation: Recommendation;
  if (overall === "insufficient" || series.length < MIN_WINDOW_MONTHS || dqMissing) {
    recommendation = {
      withheld: true,
      withheldReason:
        dqMissing
          ? "A priced asset class is missing data, so a single allocation cannot be defended."
          : series.length < MIN_WINDOW_MONTHS
            ? `Only ${series.length} months of aligned history (need ${MIN_WINDOW_MONTHS}).`
            : "Evidence is too thin to name a single allocation with confidence.",
    };
  } else {
    const curForDeploy = current ?? { equity: 0, gold: 0, btc: 0, cash: 1 };
    const deployFirst = deployFirstAsset(lead.mix.allocation, curForDeploy);
    recommendation = {
      withheld: false,
      regimeId: lead.regimeId,
      label: lead.label,
      allocation: lead.mix.allocation,
      outcome: lead.mix,
      deployFirst,
      deployment:
        input.portfolioValuePkr != null && input.investableCashPkr != null
          ? deploymentPlan(lead.mix.allocation, curForDeploy, input.portfolioValuePkr, input.investableCashPkr)
          : undefined,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    objective: OBJECTIVE_LABEL,
    horizonYears: HORIZON_YEARS,
    window: { firstMonth: model.firstMonth, lastMonth: model.lastMonth, months: series.length },
    estimates: model.estimates,
    scenarios,
    recommendation,
    benchmarks: {
      sixtyTwentyTwenty: evaluateMix(model, BENCHMARK_60_20_20),
      equalWeight: evaluateMix(model, BENCHMARK_EQUAL),
      allEquity: evaluateMix(model, BENCHMARK_EQUITY),
      riskParity: riskParityMix(model),
    },
    signals,
    events,
    confidence: { overall, components },
    backtest,
    dataQuality: input.dataQuality,
  };
}
