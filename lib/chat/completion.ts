/**
 * Response-completion detection, generation metadata, and automatic continuation
 * for the Research Copilot.
 *
 * This module is the safety net that prevents truncated answers from reaching
 * the user. It validates response completeness, normalizes provider stop
 * reasons, and builds continuation prompts when the model runs out of output
 * tokens mid-answer.
 */

// ── Generation metadata ────────────────────────────────────────────────────────

/** Normalized stop reason — collapsed from provider-specific values. */
export type GenerationFinishStatus =
  | "complete"          // natural end of response
  | "length"            // hit output token limit
  | "tool_use"          // model wants to call a tool
  | "timeout"           // request timed out
  | "cancelled"         // user or system cancelled
  | "error"             // API error
  | "stream_interrupted" // stream broke mid-response
  | "unknown";

export interface GenerationMeta {
  model: string;
  maxOutputTokens: number;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: GenerationFinishStatus;
  rawStopReason: string | null;
  requestDurationMs: number;
  firstTokenLatencyMs: number | null;
  streamComplete: boolean;
  toolCallCount: number;
  artifactCount: number;
  jsonValid: boolean;
  continuationTriggered: boolean;
  continuationCount: number;
  userStopped: boolean;
  completionStatus: ResponseCompletionStatus;
  errorCode: string | null;
}

export function emptyMeta(model: string, maxOutputTokens: number): GenerationMeta {
  return {
    model,
    maxOutputTokens,
    inputTokens: null,
    outputTokens: null,
    stopReason: "unknown",
    rawStopReason: null,
    requestDurationMs: 0,
    firstTokenLatencyMs: null,
    streamComplete: false,
    toolCallCount: 0,
    artifactCount: 0,
    jsonValid: true,
    continuationTriggered: false,
    continuationCount: 0,
    userStopped: false,
    completionStatus: "complete",
    errorCode: null,
  };
}

// ── Stop-reason normalization ──────────────────────────────────────────────────

/**
 * Normalize provider-specific stop/finish reasons into a consistent internal
 * status. Covers Anthropic (`end_turn`, `max_tokens`, `tool_use`, `stop`) and
 * OpenAI/DeepSeek (`stop`, `length`, `tool_calls`, `content_filter`).
 */
export function normalizeStopReason(raw: string | null | undefined): GenerationFinishStatus {
  if (!raw) return "unknown";
  const r = raw.toLowerCase().trim();
  if (r === "end_turn" || r === "stop") return "complete";
  if (r === "max_tokens" || r === "length") return "length";
  if (r === "tool_use" || r === "tool_calls") return "tool_use";
  if (r === "timeout") return "timeout";
  if (r === "cancelled" || r === "canceled") return "cancelled";
  if (r === "error" || r === "content_filter") return "error";
  if (r === "stream_interrupted") return "stream_interrupted";
  return "unknown";
}

// ── Response-completion validation ─────────────────────────────────────────────

export type ResponseCompletionStatus =
  | "complete"
  | "possibly_incomplete"
  | "definitely_incomplete"
  | "structurally_invalid";

/**
 * Detect whether a decision question ("should I buy/add/trim/sell/wait?") is
 * being asked.
 */
export function isDecisionQuestion(question: string): boolean {
  return /\b(should\s+I|buy\s+more|add\s+more|sell|trim|hold|wait|increase\s+(my|position)|reduce|average\s+(up|down)|accumulate)\b/i.test(question);
}

/**
 * Validate whether a model response appears complete. Catches mid-sentence
 * cutoffs, dangling headings, unclosed blocks, and missing conclusions.
 */
export function validateResponseCompletion(
  content: string,
  question: string,
  stopReason: GenerationFinishStatus
): ResponseCompletionStatus {
  const trimmed = content.trim();
  if (!trimmed) return "definitely_incomplete";

  // Strip markdown artifacts and code blocks for text analysis.
  const proseOnly = trimmed
    .replace(/```artifact[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();

  if (!proseOnly) {
    // Only artifacts, no prose — might be fine for simple lookups but
    // suspicious for decision questions.
    return isDecisionQuestion(question) ? "possibly_incomplete" : "complete";
  }

  const lastLine = proseOnly.split("\n").filter((l) => l.trim()).pop()?.trim() ?? "";
  const lastChar = lastLine.slice(-1);

  // 1. Final sentence ends mid-word or with dangling conjunction/colon.
  const DANGLERS = /\b(and|but|or|the|a|an|with|that|which|confirm|ratio|sheet)\s*\.{0,3}$/i;
  if (DANGLERS.test(lastLine)) {
    return stopReason === "length" ? "definitely_incomplete" : "possibly_incomplete";
  }

  // 2. Ends with a colon (about to enumerate something).
  if (lastChar === ":") {
    return stopReason === "length" ? "definitely_incomplete" : "possibly_incomplete";
  }

  // 3. Last line is a heading with nothing after.
  if (/^#{1,6}\s/.test(lastLine) && proseOnly.endsWith(lastLine)) {
    return "definitely_incomplete";
  }

  // 4. Unclosed markdown code fence (odd number of triple-backtick fences).
  const fenceCount = (trimmed.match(/```/g) ?? []).length;
  if (fenceCount % 2 !== 0) return "structurally_invalid";

  // 5. Incomplete table row (line with pipes but no line-ending pipe).
  if (lastLine.includes("|") && !lastLine.endsWith("|")) {
    return "possibly_incomplete";
  }

  // 6. For decision questions, check that a conclusion/decision section exists.
  if (isDecisionQuestion(question)) {
    const hasConclusion = /\b(conclusion|decision|verdict|bottom\s+line|summary|final\s+(?:assessment|view|take)|recommendation|in\s+summary)\b/i.test(proseOnly);
    const hasConditions = /\b(defensible\s+if|makes?\s+sense\s+if|becomes?\s+more|condition|would\s+change)\b/i.test(proseOnly);
    if (!hasConclusion && !hasConditions) {
      return stopReason === "length" ? "definitely_incomplete" : "possibly_incomplete";
    }
  }

  // 7. Final sentence does not end with sentence-terminal punctuation.
  if (!/[.!?"\u201D]$/.test(lastChar) && lastLine.length > 20) {
    return stopReason === "length" ? "definitely_incomplete" : "possibly_incomplete";
  }

  return "complete";
}

// ── Continuation prompt builder ────────────────────────────────────────────────

/**
 * Build a continuation prompt for the model when the response was truncated.
 * The prompt instructs the model to continue exactly where it left off.
 */
export function buildContinuationPrompt(
  originalQuestion: string,
  contentSoFar: string,
  maxTokensRemaining: number
): string {
  // Extract last ~300 chars of content for context.
  const lastChunk = contentSoFar.slice(-300).trim();

  // Detect what sections appear to be present already.
  const sections: string[] = [];
  if (/\b(position|holding|shares|quantity)\b/i.test(contentSoFar)) sections.push("position analysis");
  if (/\b(transaction|ledger|purchase|tranche)\b/i.test(contentSoFar)) sections.push("transaction history");
  if (/\b(valuation|p\/e|fcf|ratio)\b/i.test(contentSoFar)) sections.push("valuation");
  if (/\b(allocation|weight|portfolio\s+impact|sector\s+weight)\b/i.test(contentSoFar)) sections.push("allocation impact");

  const missingSuggestions: string[] = [];
  if (isDecisionQuestion(originalQuestion)) {
    if (!/\b(conclusion|verdict|decision|final\s+(assessment|view))\b/i.test(contentSoFar)) {
      missingSuggestions.push("conclusion and final assessment");
    }
    if (!/\b(risk|limitation|missing|uncertain|caveat)\b/i.test(contentSoFar)) {
      missingSuggestions.push("risks and data limitations");
    }
    if (!/\b(defensible\s+if|condition|would\s+change)\b/i.test(contentSoFar)) {
      missingSuggestions.push("decision conditions");
    }
  }

  const missingText = missingSuggestions.length
    ? `\nThe response appears to be missing: ${missingSuggestions.join(", ")}.`
    : "";

  return `Continue the response to this question from exactly where it was cut off. Do not repeat any content that was already written. Do not restart the response. Do not recalculate figures already presented.

Original question: ${originalQuestion}

Sections already covered: ${sections.join(", ") || "unknown"}.${missingText}

The response ended with:
"...${lastChunk}"

You have approximately ${maxTokensRemaining} tokens remaining. Complete the answer, ensuring the conclusion and any decision conditions are included. If space is limited, compress supporting detail but always preserve the final assessment.

Continue now:`;
}

// ── Token budget estimation ────────────────────────────────────────────────────

/**
 * Estimate how many tokens to reserve for the conclusion section. Returns a
 * string to inject into the system prompt for budget-awareness.
 */
export function tokenBudgetNote(maxTokens: number, question: string): string {
  if (!isDecisionQuestion(question)) return "";
  const reserved = Math.round(maxTokens * 0.2);
  return `\nYou have approximately ${maxTokens} output tokens. Reserve at least ${reserved} tokens for the conclusion, risks, and final decision. If approaching the limit, compress supporting detail, prefer tables over prose, and always complete the conclusion. Never stop before the decision.`;
}
