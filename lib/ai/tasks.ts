/**
 * Provider-agnostic "tasks" LLM for batch / background work — statement
 * extraction, the market brief, AI briefings, company profiles, news analysis.
 * These are high-volume, lower-bar jobs, so they run on a cheap OpenAI-compatible
 * model (DeepSeek by default; swap to Kimi/OpenRouter/etc. with three env vars,
 * no code change). The interactive Research Copilot stays on Claude.
 *
 *   TASKS_BASE_URL  default https://api.deepseek.com/v1
 *   TASKS_MODEL     default deepseek-v4-flash
 *   TASKS_API_KEY   required to enable
 *   TASKS_DISABLED  independent kill switch (see also AI_DISABLED in lib/ai/openai.ts)
 *
 * Uses the OpenAI-compatible /chat/completions shape via fetch — no extra SDK.
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
// DeepSeek V4 (deepseek-chat/deepseek-reasoner are deprecated 2026-07-24).
const DEFAULT_MODEL = "deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 120_000;

function tasksDisabled(): boolean {
  const v = (process.env.TASKS_DISABLED ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Key resolution — explicit TASKS_API_KEY wins, else the DeepSeek key by either spelling. */
function tasksKey(): string | undefined {
  return process.env.TASKS_API_KEY || process.env.DEEP_SEEK_API_KEY || process.env.DEEPSEEK_API_KEY || undefined;
}

export function tasksConfigured(): boolean {
  return !tasksDisabled() && !!tasksKey();
}

export function tasksModel(): string {
  return process.env.TASKS_MODEL || DEFAULT_MODEL;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

async function complete(messages: ChatMessage[], opts: { maxTokens: number; json: boolean; temperature: number }): Promise<{ content: string; usage: TokenUsage }> {
  if (tasksDisabled()) throw new Error("Tasks AI is disabled (TASKS_DISABLED=true).");
  const key = tasksKey();
  if (!key) throw new Error("No tasks API key (set TASKS_API_KEY or DEEP_SEEK_API_KEY).");
  const base = (process.env.TASKS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: tasksModel(),
      messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      // V4 defaults to thinking ON; force it off so batch jobs stay fast, cheap,
      // and reliable for JSON-mode extraction. Only sent for V4 models so a
      // swapped-in non-DeepSeek backend never sees an unknown parameter.
      ...(tasksModel().startsWith("deepseek-v4") ? { thinking: { type: "disabled" } } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Tasks provider HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: TokenUsage };
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (choice?.finish_reason === "length") {
    throw new Error(`Tasks response hit the ${opts.maxTokens}-token limit before completing — raise maxTokens.`);
  }
  if (!content) throw new Error("Tasks provider returned an empty response.");
  return { content, usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

/** Strip ```json fences a model may wrap JSON in, then parse. */
function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

export async function taskText(system: string, user: string, maxTokens = 1800): Promise<{ content: string; model: string; usage: TokenUsage }> {
  const { content, usage } = await complete([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens, json: false, temperature: 0.4 });
  return { content, model: tasksModel(), usage };
}

export async function taskJson<T>(system: string, user: string, maxTokens = 4000): Promise<{ data: T; model: string; usage: TokenUsage }> {
  const { content, usage } = await complete(
    [{ role: "system", content: `${system}\n\nRespond with a single valid JSON object only — no prose, no code fences.` }, { role: "user", content: user }],
    { maxTokens, json: true, temperature: 0.2 }
  );
  return { data: parseJson<T>(content), model: tasksModel(), usage };
}
