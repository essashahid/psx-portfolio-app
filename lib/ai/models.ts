/**
 * Single source of truth for the models a user can pick in the Research Copilot.
 *
 * This file is imported by BOTH the server (chat route, page) and the client
 * (the model dropdown), so it must stay pure data — no secrets, no process.env,
 * no provider SDKs. Provider readiness + the actual API calls live in
 * lib/ai/claude.ts and lib/ai/deepseek-chat.ts.
 */

export type ChatProvider = "claude" | "deepseek";

export type ChatModelId =
  | "claude-haiku"
  | "claude-sonnet"
  | "claude-opus"
  | "deepseek-chat"
  | "deepseek-reasoner";

export interface ChatModelDef {
  id: ChatModelId;
  provider: ChatProvider;
  /** Heading the dropdown groups this model under. */
  group: string;
  /** Short name shown in the picker. */
  label: string;
  /** Tooltip / one-line description. */
  hint: string;
  /** The model string sent to the provider API. */
  apiModel: string;
  /** Whether this model streams reasoning into the thinking panel. */
  thinking: boolean;
  /** Output token budget. */
  maxTokens: number;

  // Claude-only
  effort?: "low" | "medium" | "high" | "xhigh" | "max";

  // DeepSeek-only
  /** Send the (OpenAI-format) tool definitions for this model. */
  supportsTools?: boolean;
  /** deepseek-reasoner rejects sampling params — gate temperature on this. */
  supportsTemperature?: boolean;
}

export const CHAT_MODELS: ChatModelDef[] = [
  {
    id: "claude-haiku",
    provider: "claude",
    group: "Claude",
    label: "Haiku",
    hint: "Fastest, cheapest — quick lookups",
    apiModel: "claude-haiku-4-5",
    thinking: false,
    maxTokens: 1500,
  },
  {
    id: "claude-sonnet",
    provider: "claude",
    group: "Claude",
    label: "Sonnet",
    hint: "Balanced — default",
    apiModel: "claude-sonnet-4-6",
    thinking: true,
    effort: "medium",
    maxTokens: 1500,
  },
  {
    id: "claude-opus",
    provider: "claude",
    group: "Claude",
    label: "Opus",
    hint: "Deepest reasoning — multi-step analysis",
    apiModel: "claude-opus-4-8",
    thinking: true,
    effort: "high",
    maxTokens: 2200,
  },
  {
    id: "deepseek-chat",
    provider: "deepseek",
    group: "DeepSeek",
    label: "Chat (V3)",
    hint: "Fast general-purpose model",
    apiModel: "deepseek-chat",
    thinking: false,
    maxTokens: 1800,
    supportsTools: true,
    supportsTemperature: true,
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    group: "DeepSeek",
    label: "Reasoner (R1)",
    hint: "Shows its reasoning — slower, thorough",
    apiModel: "deepseek-reasoner",
    thinking: true,
    maxTokens: 2400,
    supportsTools: true,
    supportsTemperature: false,
  },
];

export const DEFAULT_MODEL_ID: ChatModelId = "claude-sonnet";

/** Resolve an id (from a request body) to its def, falling back to the default. */
export function getModelDef(id: string | null | undefined): ChatModelDef {
  return CHAT_MODELS.find((m) => m.id === id) ?? getModelDef(DEFAULT_MODEL_ID);
}

/** CHAT_MODELS grouped by `group`, preserving declaration order. */
export function groupedModels(): { group: string; models: ChatModelDef[] }[] {
  const groups: { group: string; models: ChatModelDef[] }[] = [];
  for (const m of CHAT_MODELS) {
    let bucket = groups.find((g) => g.group === m.group);
    if (!bucket) {
      bucket = { group: m.group, models: [] };
      groups.push(bucket);
    }
    bucket.models.push(m);
  }
  return groups;
}
