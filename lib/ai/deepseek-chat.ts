import type Anthropic from "@anthropic-ai/sdk";
import type { ChatModelDef } from "./models";

/**
 * Streaming DeepSeek provider for the Research Copilot.
 *
 * Distinct from lib/ai/tasks.ts (non-streaming, background cron jobs): this is
 * the interactive chat path. It speaks the OpenAI-compatible /chat/completions
 * shape with `stream: true` and function-calling, so DeepSeek gets the same
 * tool loop as Claude — the same 11 tools, just converted to OpenAI's schema.
 *
 * deepseek-reasoner streams its chain of thought via `reasoning_content`, which
 * we surface in the same thinking panel as Claude's adaptive thinking.
 *
 * Config (shared with tasks.ts): TASKS_API_KEY / DEEP_SEEK_API_KEY, optional
 * TASKS_BASE_URL. Gated by the chat kill switch CHAT_DISABLED (not the cron one).
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const REQUEST_TIMEOUT_MS = 120_000;
// Final turn drops tools so the model is forced to answer from what it gathered.
const MAX_TOOL_TURNS = 6;

function chatDisabled(): boolean {
  const v = (process.env.CHAT_DISABLED ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function deepseekKey(): string | undefined {
  return process.env.TASKS_API_KEY || process.env.DEEP_SEEK_API_KEY || process.env.DEEPSEEK_API_KEY || undefined;
}

export function deepseekChatConfigured(): boolean {
  return !chatDisabled() && !!deepseekKey();
}

/** Convert the Anthropic-shaped chat tools into OpenAI function-calling tools. */
export function toOpenAITools(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

interface ToolCallAccum {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type DSMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCallAccum[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface DeepSeekChatOptions {
  def: ChatModelDef;
  system: string;
  /** Prior turns (already trimmed by the caller). */
  history: { role: "user" | "assistant"; content: string }[];
  /** The current user message + injected <context> brief. */
  userContent: string;
  tools: Anthropic.Tool[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  onThinking: (delta: string) => void;
  onText: (delta: string) => void;
  onStatus: (text: string) => void;
  /** Clear the answer bubble — called when a turn's text was planning chatter. */
  onReset: () => void;
}

/** Run the DeepSeek chat loop, streaming text/thinking/status through callbacks. */
export async function runDeepSeekChat(opts: DeepSeekChatOptions): Promise<void> {
  if (chatDisabled()) throw new Error("Chat is disabled (CHAT_DISABLED=true). Remove the flag to resume.");
  const key = deepseekKey();
  if (!key) throw new Error("No DeepSeek key (set TASKS_API_KEY or DEEP_SEEK_API_KEY).");
  const base = (process.env.TASKS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  const useTools = !!opts.def.supportsTools && opts.tools.length > 0;
  const messages: DSMessage[] = [
    { role: "system", content: opts.system },
    ...opts.history.map((m) => ({ role: m.role, content: m.content }) as DSMessage),
    { role: "user", content: opts.userContent },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const lastTurn = turn === MAX_TOOL_TURNS - 1;
    const sendTools = useTools && !lastTurn;
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: opts.def.apiModel,
        messages,
        stream: true,
        max_tokens: opts.def.maxTokens,
        ...(opts.def.supportsTemperature ? { temperature: 0.4 } : {}),
        ...(sendTools ? { tools: toOpenAITools(opts.tools), tool_choice: "auto" as const } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`DeepSeek HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    let content = "";
    const toolCalls: ToolCallAccum[] = [];
    let finishReason: string | null = null;

    // --- Parse the SSE stream for this turn ---
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let evt: {
          choices?: {
            delta?: {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
            finish_reason?: string | null;
          }[];
        };
        try {
          evt = JSON.parse(data);
        } catch {
          continue; // skip malformed keep-alive fragments
        }
        const choice = evt.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta?.reasoning_content) opts.onThinking(delta.reasoning_content);
        if (delta?.content) {
          content += delta.content;
          opts.onText(delta.content);
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const slot = (toolCalls[tc.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.function.name += tc.function.name;
            if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }

    // No tools requested → this turn produced the final answer.
    const calls = toolCalls.filter((c) => c.id && c.function.name);
    if (finishReason !== "tool_calls" || calls.length === 0) return;

    // The visible text on a tool turn is planning narration, not the answer —
    // move it to the reasoning panel and clear the answer bubble.
    if (content.trim()) opts.onThinking(content);
    opts.onReset();

    // Execute the tools, append results, and loop.
    messages.push({ role: "assistant", content, tool_calls: calls });
    for (const call of calls) {
      opts.onStatus(`Looking up ${call.function.name.replace(/_/g, " ")}…`);
      let input: Record<string, unknown> = {};
      try {
        input = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
      } catch {
        input = {};
      }
      const out = await opts.executeTool(call.function.name, input);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out) });
    }
  }
}
