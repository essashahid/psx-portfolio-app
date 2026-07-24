import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForecastDataset, WfHorizon } from "@/lib/engine/outlook/walkforward";
import { SIDEWAYS_BAND, directionClass } from "@/lib/engine/outlook/walkforward";
import type { ExperimentalOutlook } from "@/lib/engine/outlook/experimental-outlook";

/**
 * The live scorecard.
 *
 * Phase 3 proved what the models do on history. This records what they say on
 * each live session before the outcome exists, and scores it once the horizon
 * matures. The distinction matters: a walk-forward result is evidence that a
 * method would have worked, while this is evidence that it does.
 *
 * Two rules hold throughout:
 *  - A prediction is written once and never rewritten. Only outcome columns
 *    are filled in later, so a forecast cannot be revised after the fact.
 *  - Only outputs that passed their Phase 3 gate are recorded. Recording a
 *    withheld output would invite quietly promoting it later on live evidence
 *    it was never allowed to gather.
 */

export const MODEL_VERSION = "phase3";

/** Live predictions need this many scored results before any skill claim. */
export const MIN_SCORED_FOR_SKILL = 30;

export interface PredictionRow {
  trade_date: string;
  horizon: number;
  task: "direction" | "trading-range" | "drawdown";
  threshold: number | null;
  model: string;
  model_version: string;
  entry_close: number;
  p_rise: number | null;
  p_sideways: number | null;
  p_fall: number | null;
  sideways_band: number | null;
  range_lo: number | null;
  range_hi: number | null;
  p_drawdown: number | null;
}

/**
 * Turn the current outlook into prediction rows.
 *
 * Reads the assembled outlook rather than refitting, so what is recorded is
 * exactly what the page showed that day.
 */
export function predictionsFrom(outlook: ExperimentalOutlook): PredictionRow[] {
  const rows: PredictionRow[] = [];
  const base = { trade_date: outlook.asOf, model_version: MODEL_VERSION, entry_close: outlook.close };
  const empty = {
    p_rise: null,
    p_sideways: null,
    p_fall: null,
    sideways_band: null,
    range_lo: null,
    range_hi: null,
    p_drawdown: null,
  };

  for (const h of outlook.horizons) {
    if (h.direction.status === "ok" && h.direction.probs) {
      rows.push({
        ...base,
        ...empty,
        horizon: h.sessions,
        task: "direction",
        threshold: null,
        model: h.direction.model ?? "unknown",
        p_rise: h.direction.probs.rise,
        p_sideways: h.direction.probs.sideways,
        p_fall: h.direction.probs.fall,
        sideways_band: h.direction.band,
      });
    }

    if (h.tradingRange.status === "ok" && h.tradingRange.loPct !== undefined && h.tradingRange.hiPct !== undefined) {
      rows.push({
        ...base,
        ...empty,
        horizon: h.sessions,
        task: "trading-range",
        threshold: null,
        model: "vol-scaled",
        range_lo: h.tradingRange.loPct,
        range_hi: h.tradingRange.hiPct,
      });
    }

    for (const d of h.drawdownRisk) {
      if (d.status !== "ok" || d.p === undefined) continue;
      rows.push({
        ...base,
        ...empty,
        horizon: h.sessions,
        task: "drawdown",
        threshold: d.threshold,
        model: d.model ?? "unknown",
        p_drawdown: d.p,
      });
    }
  }
  return rows;
}

/**
 * Store today's predictions. Existing rows are left untouched.
 *
 * `threshold` is stored as 0 rather than null for the tasks that have none:
 * a nullable column cannot take part in the unique constraint an upsert
 * targets, because null never equals null there. Real thresholds are negative,
 * so 0 is unambiguous.
 */
export async function recordPredictions(admin: SupabaseClient, rows: PredictionRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map((r) => ({ ...r, threshold: r.threshold ?? 0 }));
  // ignoreDuplicates keeps the original forecast when a day is reprocessed:
  // rewriting it with a later refit would silently improve the record.
  const { error } = await admin
    .from("outlook_predictions")
    .upsert(payload, { onConflict: "trade_date,horizon,task,threshold,model", ignoreDuplicates: true });
  if (error) throw error;
  return payload.length;
}

export interface ScoringResult {
  scored: number;
  pending: number;
}

/**
 * Score every prediction whose horizon has fully elapsed.
 *
 * Outcomes come from the same dataset the models read, so a scored result is
 * computed exactly as the walk-forward computed its own — otherwise live and
 * historical scores would not be comparable.
 */
export async function scoreMaturedPredictions(admin: SupabaseClient, dataset: ForecastDataset): Promise<ScoringResult> {
  const { data, error } = await admin
    .from("outlook_predictions")
    .select("id, trade_date, horizon, task, threshold, sideways_band, entry_close")
    .is("resolved_at", null)
    .order("trade_date", { ascending: true })
    .limit(500);
  if (error) throw error;
  const pending = data ?? [];
  if (pending.length === 0) return { scored: 0, pending: 0 };

  const indexOfDate = new Map(dataset.dates.map((d, i) => [d, i]));
  const now = new Date().toISOString();
  let scored = 0;
  let stillPending = 0;

  for (const row of pending) {
    const i = indexOfDate.get(row.trade_date as string);
    const h = Number(row.horizon);
    // Not yet mature: the outcome session has not happened.
    if (i === undefined || i + h >= dataset.dates.length) {
      stillPending++;
      continue;
    }

    const entry = dataset.close[i];
    const exit = dataset.close[i + h];
    if (!(entry > 0) || !(exit > 0)) {
      stillPending++;
      continue;
    }

    const ret = exit / entry - 1;
    let worst = 0;
    let best = 0;
    for (let j = i + 1; j <= i + h; j++) {
      const move = dataset.close[j] / entry - 1;
      if (move < worst) worst = move;
      if (move > best) best = move;
    }

    const band = row.sideways_band !== null ? Number(row.sideways_band) : SIDEWAYS_BAND[h as WfHorizon];
    // 0 is the "not applicable" sentinel, so only a negative value is a real
    // drawdown threshold to score against.
    const stored = row.threshold === null ? null : Number(row.threshold);
    const threshold = stored !== null && stored < 0 ? stored : null;

    const { error: updateError } = await admin
      .from("outlook_predictions")
      .update({
        resolved_at: now,
        outcome_date: dataset.dates[i + h],
        outcome_close: exit,
        outcome_return: ret,
        outcome_min: worst,
        outcome_max: best,
        outcome_class: directionClass(ret, band),
        outcome_hit: threshold !== null ? worst <= threshold : null,
      })
      .eq("id", row.id as string);
    if (updateError) throw updateError;
    scored++;
  }

  return { scored, pending: stillPending };
}

// --- Reading the record -----------------------------------------------------

export interface TaskScore {
  task: string;
  horizon: number;
  threshold: number | null;
  model: string;
  scored: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Direction: share of sessions where the most likely class occurred. */
  hitRate: number | null;
  /** Direction: the same, against a forecaster that always says the base class. */
  baselineHitRate: number | null;
  /** Ranges: share of realised paths that stayed inside the predicted band. */
  coverage: number | null;
  /** Drawdown: Brier score, and the base-rate Brier it must beat. */
  brier: number | null;
  baselineBrier: number | null;
  /** True once enough results exist to say anything. */
  reportable: boolean;
}

export interface LiveScorecard {
  generatedAt: string;
  totalScored: number;
  totalPending: number;
  scores: TaskScore[];
  note: string;
}

interface ScoredRow {
  trade_date: string;
  horizon: number;
  task: string;
  threshold: number | null;
  model: string;
  p_rise: number | null;
  p_sideways: number | null;
  p_fall: number | null;
  range_lo: number | null;
  range_hi: number | null;
  p_drawdown: number | null;
  outcome_date: string | null;
  outcome_return: number | null;
  outcome_min: number | null;
  outcome_max: number | null;
  outcome_class: number | null;
  outcome_hit: boolean | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export async function readLiveScorecard(supabase: SupabaseClient): Promise<LiveScorecard> {
  const PAGE = 1000;
  const rows: ScoredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("outlook_predictions")
      .select(
        "trade_date, horizon, task, threshold, model, p_rise, p_sideways, p_fall, range_lo, range_hi, p_drawdown, outcome_date, outcome_return, outcome_min, outcome_max, outcome_class, outcome_hit"
      )
      .not("resolved_at", "is", null)
      .order("trade_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const page = (data ?? []) as ScoredRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const { count: pendingCount } = await supabase
    .from("outlook_predictions")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);

  // Group by the unit a claim is made about.
  const groups = new Map<string, ScoredRow[]>();
  for (const r of rows) {
    // 0 is the not-applicable sentinel; keep it out of the group label.
    const thresholdKey = r.threshold !== null && Number(r.threshold) < 0 ? String(r.threshold) : "";
    const key = `${r.task}|${r.horizon}|${thresholdKey}|${r.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const scores: TaskScore[] = [];
  for (const [key, list] of groups) {
    const [task, horizonStr, thresholdStr, model] = key.split("|");
    const dates = list.map((r) => r.trade_date).sort();
    const base: TaskScore = {
      task,
      horizon: Number(horizonStr),
      threshold: thresholdStr === "" ? null : Number(thresholdStr),
      model,
      scored: list.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      hitRate: null,
      baselineHitRate: null,
      coverage: null,
      brier: null,
      baselineBrier: null,
      reportable: list.length >= MIN_SCORED_FOR_SKILL,
    };

    if (task === "direction") {
      const usable = list.filter((r) => r.outcome_class !== null && r.p_rise !== null);
      const hits = usable.filter((r) => {
        const probs = [r.p_fall ?? 0, r.p_sideways ?? 0, r.p_rise ?? 0];
        return probs.indexOf(Math.max(...probs)) === r.outcome_class;
      });
      base.hitRate = usable.length ? hits.length / usable.length : null;
      // Baseline: always predict whichever class actually occurred most often.
      const counts = [0, 0, 0];
      for (const r of usable) if (r.outcome_class !== null) counts[r.outcome_class]++;
      base.baselineHitRate = usable.length ? Math.max(...counts) / usable.length : null;
    }

    if (task === "trading-range") {
      const usable = list.filter((r) => r.outcome_min !== null && r.outcome_max !== null && r.range_lo !== null && r.range_hi !== null);
      const inside = usable.filter((r) => (r.outcome_min as number) >= (r.range_lo as number) && (r.outcome_max as number) <= (r.range_hi as number));
      base.coverage = usable.length ? inside.length / usable.length : null;
    }

    if (task === "drawdown") {
      const usable = list.filter((r) => r.p_drawdown !== null && r.outcome_hit !== null);
      base.brier = mean(usable.map((r) => ((r.p_drawdown as number) - (r.outcome_hit ? 1 : 0)) ** 2));
      // Baseline: the realised base rate over the same sessions.
      const rate = usable.length ? usable.filter((r) => r.outcome_hit).length / usable.length : null;
      base.baselineBrier = rate === null ? null : mean(usable.map((r) => (rate - (r.outcome_hit ? 1 : 0)) ** 2));
    }

    scores.push(base);
  }

  scores.sort((a, b) => a.task.localeCompare(b.task) || a.horizon - b.horizon || (a.threshold ?? 0) - (b.threshold ?? 0));

  return {
    generatedAt: new Date().toISOString(),
    totalScored: rows.length,
    totalPending: pendingCount ?? 0,
    scores,
    note: `Live results are only reported once a group has at least ${MIN_SCORED_FOR_SKILL} scored predictions. Below that, the record is shown as accumulating rather than as a measurement.`,
  };
}
