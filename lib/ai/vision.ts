import { claudeConfigured, getClaude } from "@/lib/ai/claude";

/**
 * Provider-agnostic vision LLM for reading PDFs (scanned-filing OCR +
 * extraction). Mirrors the lib/ai/tasks.ts pattern: cheap, swappable via env
 * vars, no code change to move providers.
 *
 * Resolution order:
 *   1. OpenRouter (or any OpenAI-compatible endpoint that accepts `file`
 *      content parts) when a key is set:
 *        VISION_API_KEY   or OPENROUTER_API_KEY
 *        VISION_BASE_URL  default https://openrouter.ai/api/v1
 *        VISION_MODEL     default google/gemini-2.5-flash
 *        VISION_PDF_ENGINE optional OpenRouter file-parser engine
 *                          ("native" | "pdf-text" | "mistral-ocr")
 *   2. Claude direct (CLAUDE_API_KEY) as fallback, defaulting to Haiku —
 *      never Opus — so scanned-filing OCR can't silently burn premium
 *      credits again (that emptied the account on 2026-07-05).
 *        FILINGS_OCR_MODEL default claude-haiku-4-5
 *
 * Kill switches: VISION_DISABLED (and the legacy FILINGS_OCR_DISABLED).
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";
const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";
const REQUEST_TIMEOUT_MS = 240_000; // multi-page scanned PDFs are slow to read

export function visionDisabled(): boolean {
  const v = (process.env.VISION_DISABLED ?? process.env.FILINGS_OCR_DISABLED ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function openRouterKey(): string | undefined {
  return process.env.VISION_API_KEY || process.env.OPENROUTER_API_KEY || undefined;
}

export function visionConfigured(): boolean {
  return !visionDisabled() && (!!openRouterKey() || claudeConfigured());
}

export function visionProviderLabel(): string {
  if (openRouterKey()) return `openrouter/${process.env.VISION_MODEL || DEFAULT_OPENROUTER_MODEL}`;
  if (claudeConfigured()) return `claude/${process.env.FILINGS_OCR_MODEL || DEFAULT_CLAUDE_MODEL}`;
  return "unconfigured";
}

export interface VisionUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

// Session-scoped meter so backfill scripts can report what a run consumed.
const usage: VisionUsage = { calls: 0, promptTokens: 0, completionTokens: 0 };
export function getVisionUsage(): VisionUsage {
  return { ...usage };
}

export type VisionPdfResult = { text: string; model: string } | { error: string };
export type NamedPdf = { buf: Buffer; name: string };

/**
 * Send a PDF plus instructions to the configured vision model and return the
 * raw text reply. Callers own prompt design and response parsing.
 *
 * Accepts one PDF or several — several when a single document does not carry
 * everything needed. Verifying a trailing-twelve-month figure needs BOTH the
 * latest interim AND the latest annual report; asking the agent to do that
 * off one filing means it either guesses or (correctly) refuses. Multiple
 * named files let it cross-reference the way the hand-reads did.
 */
export async function visionPdf(pdf: Buffer | NamedPdf[], system: string, user: string, maxTokens = 12_000): Promise<VisionPdfResult> {
  if (visionDisabled()) return { error: "vision extraction disabled (VISION_DISABLED)" };
  const files: NamedPdf[] = Array.isArray(pdf) ? pdf : [{ buf: pdf, name: "filing.pdf" }];
  if (files.length === 0) return { error: "no PDF provided" };

  const orKey = openRouterKey();
  if (orKey) return openRouterPdf(orKey, files, system, user, maxTokens);
  if (claudeConfigured()) return claudePdf(files, system, user, maxTokens);
  return { error: "no vision provider configured (set OPENROUTER_API_KEY / VISION_API_KEY, or CLAUDE_API_KEY)" };
}

async function openRouterPdf(key: string, files: NamedPdf[], system: string, user: string, maxTokens: number): Promise<VisionPdfResult> {
  const base = (process.env.VISION_BASE_URL || OPENROUTER_BASE).replace(/\/$/, "");
  const model = process.env.VISION_MODEL || DEFAULT_OPENROUTER_MODEL;
  const engine = process.env.VISION_PDF_ENGINE || undefined;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              ...files.map((f) => ({
                type: "file",
                file: { filename: f.name, file_data: `data:application/pdf;base64,${f.buf.toString("base64")}` },
              })),
              { type: "text", text: user },
            ],
          },
        ],
        // Only pin a file-parser engine when explicitly configured; by default
        // OpenRouter uses the model's native PDF support (free on Gemini) and
        // falls back to its own parser otherwise.
        ...(engine ? { plugins: [{ id: "file-parser", pdf: { engine } }] } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { error: `vision provider HTTP ${res.status}: ${detail.slice(0, 300)}` };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return { error: "vision provider returned an empty response" };
    usage.calls += 1;
    usage.promptTokens += data.usage?.prompt_tokens ?? 0;
    usage.completionTokens += data.usage?.completion_tokens ?? 0;
    return { text, model: `openrouter/${model}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: /timeout|abort/i.test(msg) ? `vision request timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : `vision request failed: ${msg}` };
  }
}

async function claudePdf(files: NamedPdf[], system: string, user: string, maxTokens: number): Promise<VisionPdfResult> {
  const model = process.env.FILINGS_OCR_MODEL || DEFAULT_CLAUDE_MODEL;
  try {
    const client = getClaude();
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: "user",
          content: [
            ...files.map((f) => ({
              type: "document" as const,
              source: { type: "base64" as const, media_type: "application/pdf" as const, data: f.buf.toString("base64") },
            })),
            { type: "text", text: user },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return { error: "vision extraction refused" };
    const text = response.content.find((b) => b.type === "text")?.text?.trim();
    if (!text) return { error: "vision provider returned an empty response" };
    usage.calls += 1;
    usage.promptTokens += response.usage.input_tokens;
    usage.completionTokens += response.usage.output_tokens;
    return { text, model: `claude/${model}` };
  } catch (err) {
    return { error: `vision request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
