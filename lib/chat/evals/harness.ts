import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleChatContext } from "@/lib/chat/build-context";
import { getHoldingsSummary } from "@/lib/chat/data";
import { EVAL_CASES, renderQuestion, type EvalCase, type EvalTemplateVars } from "@/lib/chat/evals/cases";

/**
 * Runs the chat grounding evals against a real user's data. For each case it
 * assembles the exact <context> brief the route would build and scores it
 * against the case's must/should/mustNot data-point checks. No LLM call — this
 * is a fast, free, deterministic regression guard on the grounding layer.
 */

export interface CheckResult {
  kind: "must" | "should" | "mustNot";
  pattern: string;
  passed: boolean;
}

export interface CaseResult {
  id: string;
  description: string;
  question: string;
  intent: string;
  briefChars: number;
  checks: CheckResult[];
  /** Hard pass: every `must` present and no `mustNot` present. */
  passed: boolean;
  /** Count of `should` checks that were missing. */
  softMissing: number;
}

export interface EvalReport {
  vars: EvalTemplateVars;
  cases: CaseResult[];
  passed: number;
  failed: number;
  total: number;
  softMissing: number;
}

/** Derive the template variables (top holding, sector, add-size) from the book. */
export async function deriveTemplateVars(supabase: SupabaseClient, userId: string): Promise<EvalTemplateVars | null> {
  const holdings = await getHoldingsSummary(supabase, userId);
  if (!holdings || holdings.holdings.length === 0) return null;
  const byWeight = [...holdings.holdings].sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));
  return {
    TOP: byWeight[0].ticker,
    SECOND: (byWeight[1] ?? byWeight[0]).ticker,
    SECTOR: holdings.sectors[0]?.sector ?? "Commercial Banks",
    AMOUNT: "PKR 100,000",
  };
}

function scoreCase(brief: string, kind: CheckResult["kind"], patterns: string[] | undefined): CheckResult[] {
  return (patterns ?? []).map((pattern) => {
    const present = new RegExp(pattern, "i").test(brief);
    // must/should pass when present; mustNot passes when absent.
    const passed = kind === "mustNot" ? !present : present;
    return { kind, pattern, passed };
  });
}

export async function runCase(
  supabase: SupabaseClient,
  userId: string,
  c: EvalCase,
  vars: EvalTemplateVars
): Promise<CaseResult> {
  const question = renderQuestion(c.question, vars);
  const { brief, resolved } = await assembleChatContext(supabase, userId, question);
  const checks = [
    ...scoreCase(brief, "must", c.must),
    ...scoreCase(brief, "should", c.should),
    ...scoreCase(brief, "mustNot", c.mustNot),
  ];
  const criticalFailed = checks.some((r) => (r.kind === "must" || r.kind === "mustNot") && !r.passed);
  const softMissing = checks.filter((r) => r.kind === "should" && !r.passed).length;
  return {
    id: c.id,
    description: c.description,
    question,
    intent: resolved.intent,
    briefChars: brief.length,
    checks,
    passed: !criticalFailed,
    softMissing,
  };
}

export async function runEvals(supabase: SupabaseClient, userId: string): Promise<EvalReport> {
  const vars = await deriveTemplateVars(supabase, userId);
  if (!vars) throw new Error("No holdings found for this user — the grounding eval needs a seeded portfolio.");

  const cases: CaseResult[] = [];
  for (const c of EVAL_CASES) {
    cases.push(await runCase(supabase, userId, c, vars));
  }
  const passed = cases.filter((c) => c.passed).length;
  return {
    vars,
    cases,
    passed,
    failed: cases.length - passed,
    total: cases.length,
    softMissing: cases.reduce((s, c) => s + c.softMissing, 0),
  };
}

/** Human-readable report for a terminal. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Chat grounding evals — ${report.passed}/${report.total} passed (${report.softMissing} soft checks missing)`);
  lines.push(`Portfolio: TOP=${report.vars.TOP}, SECOND=${report.vars.SECOND}, SECTOR=${report.vars.SECTOR}\n`);
  for (const c of report.cases) {
    lines.push(`${c.passed ? "PASS" : "FAIL"}  [${c.id}] intent=${c.intent}, brief ${c.briefChars} chars`);
    lines.push(`      ${c.question}`);
    for (const r of c.checks) {
      const mark = r.passed ? "ok  " : r.kind === "should" ? "miss" : "FAIL";
      lines.push(`        ${mark} ${r.kind}: /${r.pattern}/`);
    }
  }
  return lines.join("\n");
}
