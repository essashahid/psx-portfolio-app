import Anthropic from "@anthropic-ai/sdk";

/**
 * Claude client for the financial-assistant chat.
 *
 * Cost philosophy: the deterministic data layer + UI cards do the heavy lifting
 * (free); Claude is called once per question to write a short grounded
 * narrative over already-digested numbers, with tools as the fallback for
 * complex/multi-entity questions. The shared system prompt + tool schemas are
 * prompt-cached so repeated turns bill cached-read rates.
 *
 * The chat (Claude) has its OWN kill switch, independent of the tasks one:
 * AI_DISABLED governs the DeepSeek tasks provider; the chat is gated by CHAT_DISABLED
 * (+ the presence of CLAUDE_API_KEY). This lets the assistant run on Claude
 * while the analysis crons stay halted.
 */

export type ChatLevel = "light" | "standard" | "deep";

interface LevelConfig {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  thinking: boolean;
}

// The "levels" the user picks in the UI map to model + effort. Standard
// (Sonnet) is the default — best balance for cost-sensitive personal use;
// Deep (Opus) is reserved for heavy multi-step analysis.
const LEVELS: Record<ChatLevel, LevelConfig> = {
  light: { model: "claude-haiku-4-5", thinking: false },
  standard: { model: "claude-sonnet-4-6", effort: "medium", thinking: true },
  deep: { model: "claude-opus-4-8", effort: "high", thinking: true },
};

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

export function levelConfig(level: ChatLevel): LevelConfig {
  return LEVELS[level] ?? LEVELS.standard;
}

/** Build the generation params for a level (model, thinking, effort), SDK-ready. */
export function buildRequestParams(level: ChatLevel, maxTokens = 1500): {
  model: string;
  max_tokens: number;
  thinking?: { type: "adaptive"; display: "summarized" };
  output_config?: { effort: "low" | "medium" | "high" | "xhigh" | "max" };
} {
  const cfg = levelConfig(level);
  return {
    model: cfg.model,
    max_tokens: maxTokens,
    // Adaptive thinking with a visible summary powers the "thinking" panel in
    // the UI; Haiku ("light") has no thinking/effort, so we omit both.
    ...(cfg.thinking ? { thinking: { type: "adaptive" as const, display: "summarized" as const } } : {}),
    ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}),
  };
}
