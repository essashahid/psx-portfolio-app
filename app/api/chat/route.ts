import { requireUser } from "@/lib/api-helpers";
import { accountHasFeature, normalizeAllowedChatProviders } from "@/lib/features";
import { rejectDemoWrite } from "@/lib/demo-mode";
import { resolveMessage } from "@/lib/chat/resolver";
import { gatherCards, type Card } from "@/lib/chat/context";
import { getLatestSessionDate } from "@/lib/chat/data";
import { buildBrief } from "@/lib/chat/build-context";
import { CHAT_TOOLS, CLAUDE_TOOLS, executeTool } from "@/lib/chat/tools";
import { claudeConfigured, getClaude, buildClaudeParams } from "@/lib/ai/claude";
import { deepseekChatConfigured, runDeepSeekChat } from "@/lib/ai/deepseek-chat";
import { getModelDef } from "@/lib/ai/models";
import { looksLikeToolLeak, TOOL_LEAK_FALLBACK, stripEmDashes } from "@/lib/chat/sanitize";
import { wantsWebContext, gatherWebContext } from "@/lib/chat/web-context";
import { ArtifactExtractor, type ArtifactSpec } from "@/lib/chat/artifacts";
import {
  emptyMeta, normalizeStopReason, validateResponseCompletion,
  buildContinuationPrompt,
  type GenerationMeta,
} from "@/lib/chat/completion";
import { buildSystemPrompt } from "@/lib/chat/system-prompt";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// Max model round-trips per question. On the final turn tools are disabled so
// the model is forced to synthesize an answer instead of leaving the budget
// exhausted mid-investigation.
const MAX_TOOL_TURNS = 6;

// Soft wall-clock budget for tool exploration. The hosting platform hard-kills
// the function at its plan limit (60s on Vercel Hobby, up to `maxDuration` on
// Pro). When that happens mid-stream the client sees all the stages but never an
// answer. Before we get close, we stop calling tools and force the model to
// synthesize from whatever it has gathered, so a real answer streams within
// budget. Defaults to maxDuration minus headroom for the final write; override
// per-plan with CHAT_DEADLINE_MS (e.g. 45000 on Hobby).
const SYNTHESIS_DEADLINE_MS = Number(process.env.CHAT_DEADLINE_MS) || (maxDuration - 25) * 1000;


type Evt =
  | { type: "thread"; thread: ChatThread }
  | { type: "cards"; cards: Card[] }
  | { type: "artifact"; spec: ArtifactSpec }
  | { type: "status"; text: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "reset" }
  | { type: "meta"; meta: GenerationMeta }
  | { type: "incomplete"; reason: string }
  | { type: "error"; message: string }
  | { type: "done" };

type ChatThread = {
  id: string;
  title: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  if (!(await accountHasFeature(supabase, user.id, "/chat"))) {
    return new Response(JSON.stringify({ error: "Research Copilot is disabled for this account." }), { status: 403 });
  }
  const demoError = await rejectDemoWrite(supabase, user.id, "The demo Copilot is read-only. Browse the curated saved research instead.");
  if (demoError) return demoError;

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    model?: string;
    threadId?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response(JSON.stringify({ error: "Empty message" }), { status: 400 });
  const modelDef = getModelDef(body.model);
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("allowed_llm_providers")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) return new Response(JSON.stringify({ error: profileErr.message }), { status: 500 });
  const allowedProviders = normalizeAllowedChatProviders(profile?.allowed_llm_providers);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Evt) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      let thread: ChatThread | null = null;
      let cards: Card[] = [];
      const artifactSpecs: ArtifactSpec[] = [];
      let assistantContent = "";
      let assistantThinking = "";
      const startedAt = Date.now();
      try {
        thread = await getOrCreateThread(supabase, user.id, body.threadId, message);
        send({ type: "thread", thread });

        await supabase
          .from("chat_messages")
          .insert({ user_id: user.id, thread_id: thread.id, role: "user", content: message });

        // 1. FREE layer — resolve, gather cards, render immediately.
        send({ type: "status", text: "Checking your portfolio and PSX context" });
        const resolved = await resolveMessage(supabase, message);
        const [gathered, latestSession] = await Promise.all([
          gatherCards(supabase, user.id, resolved),
          getLatestSessionDate(supabase),
        ]);
        cards = gathered;
        if (cards.length) {
          send({ type: "cards", cards });
          send({ type: "status", text: `Prepared ${cards.length} relevant data ${cards.length === 1 ? "view" : "views"}` });
        }
        // Assemble the pre-computed brief (tranches, thesis/journal, cross-holding
        // patterns, KSE-100 benchmark returns, dividend income, macro backdrop).
        // The cards were already sent above so the UI renders them before this
        // heavier assembly finishes. See lib/chat/build-context.
        const brief = await buildBrief(supabase, user.id, { message, resolved, cards, latestSession });

        // 2. If the selected provider's AI is off, return a useful templated
        //    answer from the brief.
        const providerAllowed = allowedProviders.includes(modelDef.provider);
        const providerReady =
          providerAllowed && (modelDef.provider === "claude" ? claudeConfigured() : deepseekChatConfigured());
        if (!providerReady) {
          assistantContent = fallbackAnswer(message, brief, cards.length);
          send({ type: "text", delta: assistantContent });
          await persistAssistantTurn(supabase, user.id, thread.id, assistantContent, assistantThinking, cards);
          send({ type: "done" });
          controller.close();
          return;
        }

        // 3. Narrative. buildSystemPrompt appends retrieval guidance for
        //    tool-capable models, or the "answer from context, never promise a
        //    lookup" rule for a tool-less model so it doesn't stall on a promise.
        const systemPrompt = buildSystemPrompt(modelDef, message);

        // The brief is injected so most questions answer in one shot (no extra
        // tool round-trips).
        let userContext = brief
          ? `<context>\n${brief}\n</context>\n\nQuestion: ${message}`
          : `Question: ${message}\n(No pre-loaded data matched — use tools to fetch what you need.)`;
        const trimmedHistory = (body.history ?? []).slice(-6);

        // A tool-less model can't web_search on its own, so pre-fetch web
        // context for "why did it move" questions and inject it. Inactive while
        // every model supports tools, but kept for a future tool-less model.
        const toolless = modelDef.provider === "deepseek" && !modelDef.supportsTools;
        if (toolless && wantsWebContext(message)) {
          send({ type: "status", text: "Searching recent market coverage" });
          const web = await gatherWebContext(resolved, message);
          if (web) userContext = `${userContext}\n\n${web}`;
        }

        send({ type: "status", text: "Analyzing the evidence" });
        let writingStarted = false;
        const markWriting = () => {
          if (writingStarted) return;
          writingStarted = true;
          send({ type: "status", text: "Writing the final answer" });
        };

        if (modelDef.provider === "claude") {
          const claude = getClaude();
          const params = buildClaudeParams(modelDef);
          const messages: Anthropic.MessageParam[] = [
            ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: userContext },
          ];

          // Artifact extractor strips ```artifact blocks from the text stream
          // and routes them as separate artifact events.
          const extractor = new ArtifactExtractor(
            (raw) => {
              const delta = stripEmDashes(raw);
              markWriting();
              assistantContent += delta;
              send({ type: "text", delta });
            },
            (spec) => {
              artifactSpecs.push(spec);
              send({ type: "artifact", spec });
            }
          );

          for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
            // Force synthesis on the final allowed turn, or once we've spent the
            // soft time budget — whichever comes first — so the answer streams
            // before the platform can kill the function mid-investigation.
            const deadlineReached = Date.now() - startedAt > SYNTHESIS_DEADLINE_MS;
            const lastTurn = turn === MAX_TOOL_TURNS - 1 || deadlineReached;
            if (deadlineReached && turn < MAX_TOOL_TURNS - 1) {
              send({ type: "status", text: "Wrapping up with the evidence gathered so far" });
            }
            const turnStart = assistantContent.length;
            const mstream = claude.messages.stream({
              ...params,
              system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
              // CLAUDE_TOOLS swaps the Tavily-backed custom web_search for
              // Anthropic's server-side one; it runs the search on their side.
              tools: CLAUDE_TOOLS,
              // Final turn: forbid tools so the model must answer from what it has.
              ...(lastTurn ? { tool_choice: { type: "none" as const } } : {}),
              messages,
            } as Anthropic.MessageCreateParamsStreaming);

            mstream.on("thinking", (delta: string) => {
              assistantThinking += delta;
            });
            mstream.on("text", (delta: string) => {
              extractor.push(delta);
            });
            // Server-side web_search runs inside Anthropic's turn (no client
            // tool_use), so surface a status when its query block starts.
            mstream.on("streamEvent", (event) => {
              if (
                event.type === "content_block_start" &&
                event.content_block.type === "server_tool_use" &&
                event.content_block.name === "web_search"
              ) {
                send({ type: "status", text: toolActivityLabel("web_search") });
              }
            });

            const final = await mstream.finalMessage();
            extractor.flush();

            // Anthropic's server-side tool loop (web_search) can pause the turn
            // when it hits its internal iteration cap. Re-send the conversation
            // so it resumes — no client execution, no extra user message (the
            // trailing server_tool_use block tells the server to continue). The
            // text streamed so far is real answer text, so we keep it.
            if (final.stop_reason === "pause_turn" && !lastTurn) {
              messages.push({ role: "assistant", content: final.content });
              continue;
            }

            // Track metadata from this turn.
            const meta = emptyMeta(modelDef.apiModel, modelDef.maxTokens);
            meta.inputTokens = final.usage?.input_tokens ?? null;
            meta.outputTokens = final.usage?.output_tokens ?? null;
            meta.rawStopReason = final.stop_reason ?? null;
            meta.stopReason = normalizeStopReason(final.stop_reason);
            meta.toolCallCount += final.content.filter((b) => b.type === "tool_use").length;

            if (final.stop_reason !== "tool_use") {
              // Check for completion and auto-continue if truncated.
              meta.streamComplete = true;
              meta.artifactCount = artifactSpecs.length;
              meta.completionStatus = validateResponseCompletion(assistantContent, message, meta.stopReason);

              // Continue when the answer is truncated, or when it came back
              // empty — the latter happens on very large questions where
              // adaptive thinking consumes the whole output budget before any
              // visible text is written. `prevContent` lets us tell whether a
              // continuation attempt actually produced new prose.
              let prevContent = assistantContent;
              const answerEmpty = !assistantContent.trim();
              if (
                answerEmpty ||
                (meta.stopReason === "length" &&
                  (meta.completionStatus === "definitely_incomplete" || meta.completionStatus === "possibly_incomplete"))
              ) {
                // Auto-continuation: up to 2 attempts. These turns are a pure
                // "finish writing" pass, so thinking is disabled — otherwise a
                // continuation can spend its budget thinking and again produce
                // nothing. With thinking off, the carried-over assistant turn
                // must not contain thinking blocks, so strip them (and keep the
                // turn non-empty for the API).
                const MAX_CONTINUATIONS = 2;
                const { thinking: _omitThinking, ...paramsNoThinking } = params;
                void _omitThinking;
                const priorContent = final.content.filter(
                  (b) => b.type !== "thinking" && b.type !== "redacted_thinking"
                );
                const carriedAssistant: Anthropic.MessageParam = {
                  role: "assistant",
                  content: priorContent.length
                    ? priorContent
                    : [{ type: "text", text: "Here is the analysis:" }],
                };
                for (let ci = 0; ci < MAX_CONTINUATIONS; ci++) {
                  meta.continuationTriggered = true;
                  meta.continuationCount++;
                  send({ type: "status", text: "Completing the response" });
                  const contPrompt = buildContinuationPrompt(message, assistantContent, modelDef.maxTokens);
                  const contMessages: Anthropic.MessageParam[] = [
                    ...messages,
                    carriedAssistant,
                    { role: "user", content: contPrompt },
                  ];
                  const contStream = claude.messages.stream({
                    ...paramsNoThinking,
                    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
                    tools: [] as Anthropic.ToolUnion[],
                    tool_choice: { type: "none" as const },
                    messages: contMessages,
                  } as Anthropic.MessageCreateParamsStreaming);
                  contStream.on("text", (delta: string) => { extractor.push(delta); });
                  const contFinal = await contStream.finalMessage();
                  extractor.flush();
                  meta.outputTokens = (meta.outputTokens ?? 0) + (contFinal.usage?.output_tokens ?? 0);
                  meta.rawStopReason = contFinal.stop_reason ?? null;
                  meta.stopReason = normalizeStopReason(contFinal.stop_reason);
                  meta.completionStatus = validateResponseCompletion(assistantContent, message, meta.stopReason);
                  // Stop if complete, or if this attempt added nothing (no point retrying).
                  const madeProgress = assistantContent.length > prevContent.length;
                  prevContent = assistantContent;
                  if (meta.completionStatus === "complete" || meta.stopReason === "complete" || !madeProgress) break;
                }
              }

              // If still incomplete after continuations, inform the client.
              if (meta.completionStatus === "definitely_incomplete" || meta.completionStatus === "structurally_invalid") {
                send({ type: "incomplete", reason: `Response may be incomplete (${meta.completionStatus})` });
              }

              // Send metadata to client.
              send({ type: "meta", meta });
              break;
            }

            // The visible text on a tool turn is planning narration ("let me
            // check…"), not the answer — move it to the reasoning panel and
            // reset the answer bubble so only the final synthesis remains.
            const narration = assistantContent.slice(turnStart);
            assistantContent = assistantContent.slice(0, turnStart);
            writingStarted = false;
            extractor.reset();
            send({ type: "reset" });
            if (narration.trim()) {
              assistantThinking += (assistantThinking ? "\n\n" : "") + narration;
            }

            // Execute tools, append results, loop. The calls within a turn are
            // independent reads, so run them concurrently — sequential awaits
            // were the main driver of per-turn latency on multi-entity
            // questions. Promise.all preserves order, so results still line up
            // with their tool_use blocks.
            const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
            messages.push({ role: "assistant", content: final.content });
            for (const tu of toolUses) send({ type: "status", text: toolActivityLabel(tu.name) });
            const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
              toolUses.map(async (tu) => {
                const out = await executeTool(supabase, user.id, tu.name, (tu.input ?? {}) as Record<string, unknown>);
                return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(out) };
              })
            );
            messages.push({ role: "user", content: results });
          }
        } else {
          // DeepSeek — same tools and brief, OpenAI-shaped streaming loop.
          const dsExtractor = new ArtifactExtractor(
            (raw) => {
              const delta = stripEmDashes(raw);
              markWriting();
              assistantContent += delta;
              send({ type: "text", delta });
            },
            (spec) => {
              artifactSpecs.push(spec);
              send({ type: "artifact", spec });
            }
          );
          await runDeepSeekChat({
            def: modelDef,
            system: systemPrompt,
            history: trimmedHistory,
            userContent: userContext,
            tools: CHAT_TOOLS,
            executeTool: (name, input) => executeTool(supabase, user.id, name, input),
            onThinking: (delta) => {
              assistantThinking += delta;
            },
            onText: (delta) => {
              dsExtractor.push(delta);
            },
            onStatus: (text) => send({ type: "status", text: toolActivityLabel(text.replace(/^Looking up\s+|…$/g, "").replace(/\s/g, "_")) }),
            onReset: () => {
              assistantContent = "";
              writingStarted = false;
              dsExtractor.reset();
              send({ type: "reset" });
            },
          });
          dsExtractor.flush();
        }

        // Backstop: if the model leaked a tool call as text instead of
        // invoking it, replace the garbage answer.
        if (looksLikeToolLeak(assistantContent)) {
          send({ type: "reset" });
          assistantContent = TOOL_LEAK_FALLBACK;
          send({ type: "text", delta: assistantContent });
        }

        // Final backstop: if the model gathered evidence but never wrote a
        // visible answer (e.g. thinking ate the whole output budget), the client
        // would render an empty bubble after "Sources reviewed". Fall back to the
        // deterministic summary of what we found so the user always sees a real
        // response grounded in their data.
        if (!assistantContent.trim()) {
          send({ type: "reset" });
          assistantContent = emptyAnswerFallback(brief);
          send({ type: "text", delta: assistantContent });
        }

        await persistAssistantTurn(supabase, user.id, thread.id, assistantContent, assistantThinking, cards, artifactSpecs);
        send({ type: "done" });
        controller.close();
      } catch (err: unknown) {
        send({ type: "error", message: err instanceof Error ? err.message : "Chat failed" });
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function toolActivityLabel(name: string): string {
  const key = name.toLowerCase().replace(/^looking_up_/, "");
  const labels: Record<string, string> = {
    get_portfolio_summary: "Reviewing portfolio allocation and performance",
    get_position: "Reviewing the selected holding",
    get_position_history: "Reviewing transactions and allocation impact",
    list_holdings: "Comparing portfolio holdings",
    get_thesis: "Reading your investment thesis",
    get_journal: "Reviewing your decision journal",
    get_quote: "Fetching the latest market data",
    get_ratios: "Checking valuation and fundamentals",
    get_technicals: "Reviewing price structure and momentum",
    compute_indicator: "Computing the requested indicator from price history",
    get_dividends: "Checking dividend history and income",
    get_news: "Reviewing PSX filings and announcements",
    get_market: "Reading the current PSX market snapshot",
    get_sectors: "Comparing sector performance",
    get_foreign_flows: "Checking investor flow data",
    web_search: "Searching recent market coverage",
  };
  return labels[key] ?? `Reviewing ${key.replace(/_/g, " ")}`;
}

async function getOrCreateThread(
  supabase: SupabaseClient,
  userId: string,
  threadId: string | null | undefined,
  message: string
): Promise<ChatThread> {
  if (threadId) {
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id, title, summary, created_at, updated_at, last_message_at")
      .eq("user_id", userId)
      .eq("id", threadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Chat not found.");
    return data as ChatThread;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("chat_threads")
    .insert({
      user_id: userId,
      title: titleFromMessage(message),
      summary: summaryFromContent(message),
      last_message_at: now,
      updated_at: now,
    })
    .select("id, title, summary, created_at, updated_at, last_message_at")
    .single();

  if (error) throw new Error(error.message);
  return data as ChatThread;
}

async function persistAssistantTurn(
  supabase: SupabaseClient,
  userId: string,
  threadId: string,
  content: string,
  thinking: string,
  cards: Card[],
  artifactSpecs: ArtifactSpec[] = []
) {
  const now = new Date().toISOString();
  const cleanContent = content.trim();
  // Store artifact specs alongside data cards so they can be re-rendered when
  // the thread is reloaded. They use a distinct "artifact" kind so the existing
  // ChatCards renderer ignores them while the new ArtifactRenderer handles them.
  const allCards: unknown[] = [
    ...cards,
    ...artifactSpecs.map((s) => ({ kind: "artifact", data: s })),
  ];
  if (cleanContent) {
    const { error } = await supabase.from("chat_messages").insert({
      user_id: userId,
      thread_id: threadId,
      role: "assistant",
      content: cleanContent,
      thinking: thinking.trim() || null,
      cards: allCards.length ? allCards : null,
    });
    if (error) throw new Error(error.message);
  }

  const { error } = await supabase
    .from("chat_threads")
    .update({
      summary: summaryFromContent(cleanContent),
      updated_at: now,
      last_message_at: now,
    })
    .eq("user_id", userId)
    .eq("id", threadId);
  if (error) throw new Error(error.message);
}

function titleFromMessage(message: string): string {
  const cleaned = message
    .replace(/\s+/g, " ")
    .replace(/[^\w\s./&-]/g, "")
    .trim();
  if (!cleaned) return "New chat";
  const words = cleaned.split(" ").slice(0, 8).join(" ");
  return words.length > 80 ? `${words.slice(0, 77)}...` : words;
}

function summaryFromContent(content: string): string | null {
  const cleaned = content
    .replace(/[#*_>`~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 150 ? `${cleaned.slice(0, 147)}...` : cleaned;
}

/**
 * Shown when the model finished but produced no visible prose (e.g. its output
 * budget was spent entirely on reasoning). Surfaces the gathered data instead of
 * a blank bubble, and tells the user how to get a full written answer.
 */
function emptyAnswerFallback(brief: string): string {
  const ask = "This was a broad question and the model ran out of room to write the full analysis. Here is the data it gathered. For a complete written answer, ask about one or two holdings at a time, or a single sector.";
  return brief ? `${ask}\n\n${brief}` : ask;
}

/** Deterministic answer when the LLM is disabled — uses the same digested numbers. */
function fallbackAnswer(message: string, brief: string, cardCount: number): string {
  if (!brief && cardCount === 0) {
    return "I couldn't find any matching PSX data for that. Try naming a ticker (e.g. MEBL) or asking about the market. (AI narration is currently turned off — the data cards above are live.)";
  }
  return `Here's what the live data shows:\n\n${brief}\n\n_(AI narration is turned off right now, so this is the raw data summary. Turn it back on to get an interpreted answer.)_`;
}
