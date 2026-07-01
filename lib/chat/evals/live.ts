import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { assembleChatContext } from "@/lib/chat/build-context";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import { getModelDef, type ChatModelDef } from "@/lib/ai/models";
import { runDeepSeekChat, deepseekChatConfigured } from "@/lib/ai/deepseek-chat";
import { getClaude, buildClaudeParams, claudeConfigured } from "@/lib/ai/claude";
import { stripEmDashes } from "@/lib/chat/sanitize";
import { checkNumericFidelity, stripArtifacts, type FidelityResult } from "@/lib/chat/evals/numeric-fidelity";
import { EVAL_CASES, renderQuestion, type EvalCase, type EvalTemplateVars } from "@/lib/chat/evals/cases";
import { deriveTemplateVars } from "@/lib/chat/evals/harness";

/**
 * Live-answer eval: generates a real model answer for each case from the exact
 * production system prompt and brief, then scores the ANSWER (not just the
 * context) for the failures the Copilot must never make — hedging, em dashes,
 * ungrounded numbers, and missing the figures the question needs. Complements the
 * fast context eval (harness.ts): that proves the data was handed over, this
 * proves the model used it well.
 *
 * Answers are generated tool-lessly from the pre-loaded brief: the context eval
 * already proves the brief is complete, so this isolates "given the data, does
 * the model narrate it faithfully" without tool-loop cost or nondeterminism.
 */

// Phrases that betray the hedging / generic-LLM behaviour the prompt forbids.
const HEDGING = [
  "i don't have", "i do not have", "without your full", "without access",
  "i cannot calculate", "i can't calculate", "as an ai", "i'm unable", "i am unable",
  "not financial advice", "let me check", "give me a moment", "i'll look", "i will look",
  "what's missing", "what is missing", "i don't have access", "unable to access",
];

/** Minimum grounded percentage below which numeric fidelity fails the case. */
const FIDELITY_FAIL_BELOW = 60;

export interface LiveCaseResult {
  id: string;
  question: string;
  intent: string;
  answerChars: number;
  hedging: string[];
  emDash: boolean;
  answerMustMissing: string[];
  /** Artifact kinds the answer emitted (visual coverage, informational). */
  artifactKinds: string[];
  /** True when a substantive answer is an unstructured wall of prose. */
  proseWall: boolean;
  fidelity: FidelityResult;
  passed: boolean;
  error?: string;
}

export interface LiveReport {
  model: string;
  vars: EvalTemplateVars;
  cases: LiveCaseResult[];
  passed: number;
  failed: number;
  total: number;
}

/** Generate an answer tool-lessly from the injected brief, matching production framing. */
async function generateAnswer(modelDef: ChatModelDef, question: string, brief: string): Promise<string> {
  const systemPrompt = buildSystemPrompt(modelDef, question, { canUseTools: false });
  const userContext = brief
    ? `<context>\n${brief}\n</context>\n\nQuestion: ${question}`
    : `Question: ${question}`;

  if (modelDef.provider === "deepseek") {
    let answer = "";
    await runDeepSeekChat({
      def: modelDef,
      system: systemPrompt,
      history: [],
      userContent: userContext,
      tools: [],
      executeTool: async () => ({}),
      onThinking: () => {},
      onText: (d) => { answer += d; },
      onStatus: () => {},
      onReset: () => { answer = ""; },
    });
    return stripEmDashes(answer);
  }

  const claude = getClaude();
  const params = buildClaudeParams(modelDef);
  const stream = claude.messages.stream({
    ...params,
    system: [{ type: "text", text: systemPrompt }],
    tools: [] as Anthropic.ToolUnion[],
    messages: [{ role: "user", content: userContext }],
  } as Anthropic.MessageCreateParamsStreaming);
  let answer = "";
  stream.on("text", (d: string) => { answer += d; });
  await stream.finalMessage();
  return stripEmDashes(answer);
}

export async function runLiveCase(
  supabase: SupabaseClient,
  userId: string,
  modelDef: ChatModelDef,
  c: EvalCase,
  vars: EvalTemplateVars
): Promise<LiveCaseResult> {
  const question = renderQuestion(c.question, vars);
  const { brief, resolved } = await assembleChatContext(supabase, userId, question);

  let answer = "";
  try {
    answer = await generateAnswer(modelDef, question, brief);
  } catch (err) {
    return {
      id: c.id, question, intent: resolved.intent, answerChars: 0,
      hedging: [], emDash: false, answerMustMissing: [], artifactKinds: [], proseWall: false, passed: false,
      fidelity: { checked: 0, matched: 0, groundedPct: null, unmatched: [] },
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const lower = answer.toLowerCase();
  const hedging = HEDGING.filter((p) => lower.includes(p));
  const emDash = answer.includes("—");
  const answerMustMissing = (c.answerMust ?? [])
    .map((p) => renderQuestion(p, vars))
    .filter((p) => !new RegExp(p, "i").test(answer));
  const artifactKinds = extractArtifactKinds(answer);
  const proseWall = isProseWall(answer);
  const fidelity = checkNumericFidelity(answer, brief);

  const fidelityOk = fidelity.groundedPct === null || fidelity.groundedPct >= FIDELITY_FAIL_BELOW;
  const passed = hedging.length === 0 && !emDash && answerMustMissing.length === 0 && !proseWall && fidelityOk;

  return {
    id: c.id, question, intent: resolved.intent, answerChars: answer.length,
    hedging, emDash, answerMustMissing, artifactKinds, proseWall, fidelity, passed,
  };
}

/**
 * Format guardrail (not a per-case artifact rule): a substantial answer that is
 * pure paragraphs, with no visual, table, or list, is the "prose wall" the
 * Copilot must avoid. The prompt is what drives good structure; this only catches
 * regressions where the output slides back to a block of text.
 */
function isProseWall(answer: string): boolean {
  const prose = stripArtifacts(answer);
  const hasArtifact = /```artifact/.test(answer);
  const hasTable = /\|.*\|/.test(prose) && /\|\s*:?-+:?\s*\|/.test(prose);
  const hasBullets = /^\s*[-*]\s/m.test(prose);
  // Substantive answers must carry some structure; a heading over paragraphs is
  // still a wall, so headings alone do not count as rescuing structure.
  return prose.trim().length > 650 && !hasArtifact && !hasTable && !hasBullets;
}

/** Pull the `kind` of every fenced ```artifact block the model emitted. */
function extractArtifactKinds(answer: string): string[] {
  const kinds: string[] = [];
  for (const m of answer.matchAll(/```artifact\s*([\s\S]*?)```/gi)) {
    try {
      const spec = JSON.parse(m[1].trim()) as { kind?: string };
      if (spec?.kind) kinds.push(spec.kind);
    } catch {
      kinds.push("unparseable");
    }
  }
  return kinds;
}

export async function runLiveEvals(supabase: SupabaseClient, userId: string, modelId: string): Promise<LiveReport> {
  const modelDef = getModelDef(modelId);
  const ready = modelDef.provider === "claude" ? claudeConfigured() : deepseekChatConfigured();
  if (!ready) throw new Error(`Model ${modelDef.id} (${modelDef.provider}) is not configured — set its API key.`);

  const vars = await deriveTemplateVars(supabase, userId);
  if (!vars) throw new Error("No holdings found for this user — the live eval needs a seeded portfolio.");

  const cases: LiveCaseResult[] = [];
  for (const c of EVAL_CASES) {
    cases.push(await runLiveCase(supabase, userId, modelDef, c, vars));
  }
  const passed = cases.filter((c) => c.passed).length;
  return { model: modelDef.id, vars, cases, passed, failed: cases.length - passed, total: cases.length };
}

export function formatLiveReport(report: LiveReport): string {
  const lines: string[] = [];
  lines.push(`Live-answer evals (${report.model}) — ${report.passed}/${report.total} passed`);
  lines.push(`Portfolio: TOP=${report.vars.TOP}, SECOND=${report.vars.SECOND}, SECTOR=${report.vars.SECTOR}\n`);
  for (const c of report.cases) {
    lines.push(`${c.passed ? "PASS" : "FAIL"}  [${c.id}] intent=${c.intent}, answer ${c.answerChars} chars`);
    lines.push(`      ${c.question}`);
    if (c.error) lines.push(`        ERROR: ${c.error}`);
    if (c.hedging.length) lines.push(`        FAIL hedging: ${c.hedging.map((h) => `"${h}"`).join(", ")}`);
    if (c.emDash) lines.push(`        FAIL em dash present`);
    if (c.answerMustMissing.length) lines.push(`        FAIL answer missing: ${c.answerMustMissing.map((p) => `/${p}/`).join(", ")}`);
    if (c.proseWall) lines.push(`        FAIL prose wall (substantive answer with no visual, table, or list)`);
    lines.push(`        ${c.artifactKinds.length ? "ok  " : "--  "} visuals: [${c.artifactKinds.join(", ") || "none"}]`);
    const f = c.fidelity;
    const fMark = f.groundedPct === null ? "n/a" : f.groundedPct >= FIDELITY_FAIL_BELOW ? "ok" : "FAIL";
    lines.push(`        ${fMark} numeric fidelity: ${f.matched}/${f.checked} grounded${f.groundedPct !== null ? ` (${f.groundedPct.toFixed(0)}%)` : ""}`);
    for (const u of f.unmatched) lines.push(`          ungrounded ${u.kind} ${u.raw}: "${u.context}"`);
  }
  return lines.join("\n");
}
