import Anthropic from "@anthropic-ai/sdk";
import type { ChatModelDef } from "./models";

/**
 * Claude client for the financial-assistant chat.
 *
 * Cost philosophy: the deterministic data layer + UI cards do the heavy lifting
 * (free); Claude is called once per question to write a short grounded
 * narrative over already-digested numbers, with tools as the fallback for
 * complex/multi-entity questions. The shared system prompt + tool schemas are
 * prompt-cached so repeated turns bill cached-read rates.
 *
 * The chat has its OWN kill switch, independent of the tasks one: AI_DISABLED
 * governs the DeepSeek tasks/cron provider; the chat is gated by CHAT_DISABLED.
 * Which provider/model handles a given turn is chosen in the UI — see
 * lib/ai/models.ts for the registry and lib/ai/deepseek-chat.ts for the other
 * provider.
 */

/** Independent chat kill switch — does NOT touch the tasks AI_DISABLED flag. */
export function chatDisabled(): boolean {
  const v = (process.env.CHAT_DISABLED ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function claudeConfigured(): boolean {
  return !chatDisabled() && !!process.env.CLAUDE_API_KEY;
}

let client: Anthropic | null = null;
export function getClaude(): Anthropic {
  if (chatDisabled()) throw new Error("Chat is disabled (CHAT_DISABLED=true). Remove the flag to resume.");
  if (!process.env.CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY is not configured.");
  client ??= new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
  return client;
}

/** Build the generation params for a Claude model def (model, thinking, effort), SDK-ready. */
export function buildClaudeParams(def: ChatModelDef): {
  model: string;
  max_tokens: number;
  thinking?: { type: "adaptive"; display: "summarized" };
  output_config?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
} {
  return {
    model: def.apiModel,
    max_tokens: def.maxTokens,
    // Adaptive thinking with a visible summary powers the "thinking" panel in
    // the UI; Haiku has no thinking/effort, so we omit both.
    ...(def.thinking ? { thinking: { type: "adaptive" as const, display: "summarized" as const } } : {}),
    ...(def.effort ? { output_config: { effort: def.effort } } : {}),
  };
}
