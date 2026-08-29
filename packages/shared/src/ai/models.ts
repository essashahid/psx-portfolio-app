/**
 * Single source of truth for the models a user can pick in the Research Copilot.
 *
 * Imported by the server (chat route, page), the web dropdown and the phone,
 * so it stays pure data: no secrets, nothing read from the environment,
 * no provider SDKs. Readiness and the API calls live in lib/ai/claude.ts and
 * lib/ai/deepseek-chat.ts, which are server-only.
 */

export type ChatProvider = "claude" | "deepseek";

export type ChatModelId =
  | "claude-haiku"
  | "claude-sonnet"
  | "claude-opus"
  | "deepseek-pro";

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
  /** DeepSeek thinking mode rejects/ignores sampling params — gate temperature on this. */
  supportsTemperature?: boolean;
}

export const CHAT_MODELS: ChatModelDef[] = [
  {
    id: "claude-haiku",
    provider: "claude",
    group: "Claude",
    label: "Haiku",
    hint: "Fastest and cheapest, for quick lookups",
    apiModel: "claude-haiku-4-5",
    thinking: false,
    maxTokens: 4000,
  },
  {
    id: "claude-sonnet",
    provider: "claude",
    group: "Claude",
    label: "Sonnet",
    hint: "Balanced. The default",
    apiModel: "claude-sonnet-4-6",
    thinking: true,
    effort: "medium",
    maxTokens: 12000,
  },
  {
    id: "claude-opus",
    provider: "claude",
    group: "Claude",
    label: "Opus",
    hint: "Deepest reasoning, for multi-step analysis",
    apiModel: "claude-opus-4-8",
    thinking: true,
    effort: "high",
    maxTokens: 16000,
  },
  {
    id: "deepseek-pro",
    provider: "deepseek",
    group: "DeepSeek",
    label: "Pro (V4)",
    hint: "Tool-capable portfolio research",
    // DeepSeek V4. Runs in NON-thinking mode (thinking is a request parameter
    // now, defaulting to ON, so deepseek-chat.ts disables it). Non-thinking plus
    // tools is the reliable path for this app's multi-turn research loop. This
    // replaces both the deprecated deepseek-chat (V3) and deepseek-reasoner (R1);
    // R1 was tool-less, which is why it could not retrieve portfolio data.
    apiModel: "deepseek-v4-pro",
    thinking: false,
    maxTokens: 8000,
    supportsTools: true,
    supportsTemperature: true,
  },
];

export const DEFAULT_MODEL_ID: ChatModelId = "claude-sonnet";

/** Resolve an id (from a request body) to its def, falling back to the default. */
export function getModelDef(id: string | null | undefined): ChatModelDef {
  // Backward compatibility for clients that still have the old selector value
  // in localStorage from when the DeepSeek option was V4 Flash.
  if (id === "deepseek-flash") return getModelDef("deepseek-pro");
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


/** Whether a provider is both configured on the server and allowed for this account. */
export type ProviderStatus = Record<ChatProvider, { configured: boolean; allowed: boolean }>;

export function providerReady(providers: ProviderStatus, provider: ChatProvider): boolean {
  return Boolean(providers[provider]?.configured && providers[provider]?.allowed);
}

/**
 * The model to open on: the default when it is usable, otherwise the first
 * model that is. Picking an unusable default would put the user one refused
 * request away from an error before they have done anything.
 */
export function firstAvailableModel(providers: ProviderStatus): ChatModelId {
  const preferred = getModelDef(DEFAULT_MODEL_ID);
  if (providerReady(providers, preferred.provider)) return preferred.id;
  return CHAT_MODELS.find((m) => providerReady(providers, m.provider))?.id ?? DEFAULT_MODEL_ID;
}
