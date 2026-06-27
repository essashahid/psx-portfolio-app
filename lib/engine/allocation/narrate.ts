import { taskJson, tasksConfigured, tasksModel } from "@/lib/ai/tasks";
import { ASSET_LABEL, type AllocationForecast, type AllocationNarrative, type Allocation } from "./index";

/**
 * Prose layer for the forecast. The LLM is EXPLANATORY ONLY: it receives the
 * already-computed numbers and may restate or interpret them, but a numeric
 * guard rejects any output that introduces a number not present in the payload.
 * If the guard trips, or no tasks model is configured, we fall back to a
 * deterministic template built purely from the payload. Plain language, no
 * em dashes (house style).
 */

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function mixWords(a: Allocation): string {
  return (Object.keys(a) as (keyof Allocation)[])
    .filter((k) => a[k] >= 0.005)
    .sort((x, y) => a[y] - a[x])
    .map((k) => `${ASSET_LABEL[k]} ${pct(a[k])}`)
    .join(", ");
}

/** Deterministic, always-safe narrative derived only from computed numbers. */
export function buildDeterministicNarrative(f: AllocationForecast): AllocationNarrative {
  const lead = f.scenarios[0];
  const bench = f.benchmarks.sixtyTwentyTwenty;

  const scenarioNotes: Record<string, string> = {};
  for (const s of f.scenarios) {
    const driver = s.drivers[0]?.label;
    scenarioNotes[s.regimeId] =
      `${s.thesis} At a ${pct(s.probability)} chance of this regime, the fitting mix is ${mixWords(s.mix.allocation)}, ` +
      `for about ${pct(s.mix.expReturn)} expected real return with a ${pct(s.mix.probLoss)} chance of a five-year loss` +
      (driver ? `. The strongest current signal behind it is ${driver.toLowerCase()}.` : ".");
  }

  let recommendationNote: string;
  if (f.recommendation.withheld) {
    recommendationNote =
      `No single allocation is recommended right now. ${f.recommendation.withheldReason} ` +
      `The scenarios and the 60-20-20 benchmark are still shown so you can judge the range yourself.`;
  } else {
    const o = f.recommendation.outcome!;
    recommendationNote =
      `The lead scenario is ${f.recommendation.label} at ${pct(lead.probability)}. ` +
      `Its mix targets ${mixWords(f.recommendation.allocation!)}, expected to return about ${pct(o.expReturn)} real ` +
      `against ${pct(bench.expReturn)} for the 60-20-20 benchmark. ` +
      `If you are deploying new capital, start with ${ASSET_LABEL[f.recommendation.deployFirst!]}, where you are furthest below target. ` +
      `Remember the ${pct(lead.probability)} is the chance of the regime, not the chance this mix makes money.`;
  }

  const eventsNote = f.events.length
    ? `Structured events in the current window: ${f.events.map((e) => e.label).join("; ")}. These feed the regime scores through fixed rules, within capped limits.`
    : "No notable structured geopolitical events are weighing on the regime scores this period.";

  const summary =
    `Objective: ${f.objective.toLowerCase()}. ` +
    `Across ${f.scenarios.length} macro regimes, ${lead.label} is the most likely at ${pct(lead.probability)}. ` +
    (f.recommendation.withheld
      ? `Confidence is ${f.confidence.overall}, so no single allocation is named. `
      : `The recommended mix is ${mixWords(f.recommendation.allocation!)}, at ${f.confidence.overall} confidence. `) +
    `Over the ${f.backtest.core.observations}-observation out-of-sample test the model returned ${pct(f.backtest.strategies[0].annReturn)} a year ` +
    `versus ${pct(f.backtest.strategies.find((s) => s.name.includes("60-20-20"))?.annReturn ?? 0)} for the naive 60-20-20 rule.`;

  return { summary, scenarioNotes, recommendationNote, eventsNote, model: "deterministic" };
}

/** Collect every number the payload legitimately contains, as rounded integers. */
function allowedNumberSet(f: AllocationForecast): Set<number> {
  const set = new Set<number>();
  const add = (x: number | null | undefined) => {
    if (x == null || !Number.isFinite(x)) return;
    set.add(Math.round(x)); // raw
    set.add(Math.round(x * 100)); // as a percent
  };
  add(f.horizonYears);
  add(f.window.months);
  add(f.backtest.core.observations);
  for (const s of f.scenarios) {
    add(s.probability);
    add(s.mix.expReturn); add(s.mix.expReturnLow); add(s.mix.expReturnHigh);
    add(s.mix.volatility); add(s.mix.estDrawdown); add(s.mix.probLoss);
    for (const k of Object.keys(s.mix.allocation) as (keyof Allocation)[]) add(s.mix.allocation[k]);
    for (const st of s.stress) add(st.mixReturn);
  }
  for (const b of [f.benchmarks.sixtyTwentyTwenty, f.benchmarks.equalWeight, f.benchmarks.allEquity]) {
    add(b.expReturn); add(b.volatility); add(b.estDrawdown); add(b.probLoss);
  }
  for (const st of f.backtest.strategies) {
    add(st.annReturn); add(st.annVol); add(st.maxDrawdown); add(st.hitRate);
  }
  return set;
}

/**
 * True if every number in `text` is either a year, a small structural count, or
 * within +-1 of a value the payload contains. Guards against the LLM inventing
 * figures.
 */
function passesNumericGuard(text: string, allowed: Set<number>): boolean {
  const matches = text.match(/\d+(?:\.\d+)?/g);
  if (!matches) return true;
  for (const m of matches) {
    const n = Math.round(parseFloat(m));
    if (n >= 2000 && n <= 2100) continue; // years
    if (n <= 5) continue; // horizon, scenario/asset counts, small ordinals
    const ok = [...allowed].some((a) => Math.abs(a - n) <= 1);
    if (!ok) return false;
  }
  return true;
}

interface LlmNarrative {
  summary?: string;
  scenarioNotes?: Record<string, string>;
  recommendationNote?: string;
  eventsNote?: string;
}

/** Compact JSON of the computed numbers handed to the model as ground truth. */
function payloadForPrompt(f: AllocationForecast) {
  return {
    objective: f.objective,
    horizonYears: f.horizonYears,
    confidence: f.confidence.overall,
    leadRegime: f.scenarios[0]?.label,
    scenarios: f.scenarios.map((s) => ({
      id: s.regimeId,
      label: s.label,
      thesis: s.thesis,
      probabilityPct: +(s.probability * 100).toFixed(1),
      mixPct: Object.fromEntries(Object.entries(s.mix.allocation).map(([k, v]) => [k, +(v * 100).toFixed(1)])),
      expReturnPct: +(s.mix.expReturn * 100).toFixed(1),
      probLossPct: +(s.mix.probLoss * 100).toFixed(1),
      topDrivers: s.drivers.map((d) => d.label),
    })),
    recommendation: f.recommendation.withheld
      ? { withheld: true, reason: f.recommendation.withheldReason }
      : { label: f.recommendation.label, deployFirst: f.recommendation.deployFirst },
    benchmark6020ExpReturnPct: +(f.benchmarks.sixtyTwentyTwenty.expReturn * 100).toFixed(1),
    events: f.events.map((e) => ({ label: e.label, detail: e.detail })),
  };
}

const SYSTEM = `You explain a capital-allocation forecast for a long-term Pakistani investor.
Hard rules:
- Use ONLY numbers that appear in the provided data. Never invent or recompute a figure.
- A scenario probability is the chance of the macro REGIME, not the chance the allocation makes money. Keep that distinction.
- Plain, complete sentences. No em dashes. No "not financial advice" disclaimers. No trading or stop-loss talk.
- Interpret and connect the data; do not just list it.
Return a JSON object with: summary, scenarioNotes (object keyed by scenario id), recommendationNote, eventsNote.`;

/**
 * Produce the narrative. Each field is taken from the LLM only if it passes the
 * numeric guard; otherwise the deterministic version of that field is used.
 */
export async function narrateForecast(f: AllocationForecast): Promise<AllocationNarrative> {
  const deterministic = buildDeterministicNarrative(f);
  if (!tasksConfigured()) return deterministic;

  try {
    const allowed = allowedNumberSet(f);
    const { data } = await taskJson<LlmNarrative>(SYSTEM, JSON.stringify(payloadForPrompt(f)), 1600);

    const guard = (llm: string | undefined, fallback: string) =>
      llm && passesNumericGuard(llm, allowed) ? llm : fallback;

    const scenarioNotes: Record<string, string> = {};
    for (const s of f.scenarios) {
      scenarioNotes[s.regimeId] = guard(data.scenarioNotes?.[s.regimeId], deterministic.scenarioNotes[s.regimeId]);
    }

    return {
      summary: guard(data.summary, deterministic.summary),
      scenarioNotes,
      recommendationNote: guard(data.recommendationNote, deterministic.recommendationNote),
      eventsNote: guard(data.eventsNote, deterministic.eventsNote),
      model: tasksModel(),
    };
  } catch {
    return deterministic;
  }
}
