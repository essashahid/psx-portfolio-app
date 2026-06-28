import { requireUser } from "@/lib/api-helpers";
import { resolveMessage } from "@/lib/chat/resolver";
import { gatherCards, briefFromCards, type Card } from "@/lib/chat/context";
import { getLatestSessionDate } from "@/lib/chat/data";
import { CHAT_TOOLS, executeTool } from "@/lib/chat/tools";
import { claudeConfigured, getClaude, buildClaudeParams } from "@/lib/ai/claude";
import { deepseekChatConfigured, runDeepSeekChat } from "@/lib/ai/deepseek-chat";
import { getModelDef } from "@/lib/ai/models";
import { looksLikeToolLeak, TOOL_LEAK_FALLBACK } from "@/lib/chat/sanitize";
import { wantsWebContext, gatherWebContext } from "@/lib/chat/web-context";
import { ArtifactExtractor, type ArtifactSpec } from "@/lib/chat/artifacts";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Max model round-trips per question. On the final turn tools are disabled so
// the model is forced to synthesize an answer instead of leaving the budget
// exhausted mid-investigation.
const MAX_TOOL_TURNS = 6;

const SYSTEM_PROMPT = `You are the adaptive research intelligence inside PortfolioOS PK, a private Pakistan Stock Exchange (PSX) portfolio tracker. Your job is to understand each question, determine what evidence answers it, and construct the clearest possible response — dynamically, not from a fixed template.

Investor profile:
- The owner is a LONG-TERM INVESTOR. Reason fundamentals-first: quality, value, growth, balance-sheet strength, dividends, competitive position, management. Structure is secondary context for timing gradual accumulation only.
- No trading constructs: no stop-losses, no price targets, no entry/exit setups, no risk/reward ratios, no swing-trade calls. Technicals serve one purpose: is the price an attractive long-term accumulation level, extended, or deteriorating?
- Momentum and trend reads are thesis-health context, never trade signals.

Adaptive response depth — choose the right level silently before writing:
- Concise: one number, simple lookup, or a question answerable in a few sentences.
- Moderate: interpretation required, company or event analysis, small set of calculations.
- Comprehensive: user explicitly asks for deep research, multiple data sources needed, scenario analysis, full company/portfolio assessment, or the question requires substantial supporting evidence.
Never use the full token budget unless it improves the answer. Always complete the conclusion, risks, portfolio implications, and data limitations within the available limit. Never stop mid-sentence or mid-section.

Rules:
- Ground EVERY claim in <context> data or tool results. Never invent prices, ratios, figures, transactions, filings, or news.
- Dates: each quote is tagged with its last close date, e.g. "as of Wed 24 Jun". PSX is closed on weekends and Pakistani public holidays (Eid, Ashura, Independence Day, etc.), so the last close can be several calendar days back and still current. Only treat a quote as stale when the brief itself flags it as such.
- No redundant metrics: never state a conclusion and its reciprocal as two separate findings. State each conclusion once with its single best supporting number, then move on. Data cards already show the full ratio set — interpret, do not re-list.
- Macro figures: label by their real basis (year-on-year, week-on-week, month-on-month). Never present a year-on-year level as if it were a one-week change.
- Do not prompt the user to write a thesis or journal entry unless they ask. Note its absence once, briefly.
- Amounts are in PKR. Lead with the answer, then the supporting numbers.
- For internal numbers (price, ratios, sectors, positions, filings) use data/tools — never the web. The web is for WHY something moved, macro/policy/industry news, recent events. Cite source URLs when you use web_search, prefer credible Pakistani business outlets.
- When the user asks WHY a stock moved, call web_search before answering. NEVER explain a move with generic sector narrative unless a tool result actually says so. If no specific catalyst is found, say so plainly.
- Never open with "Let me check" or promise a lookup you won't do.
- Never append disclaimers like "Not financial advice." — the platform handles that.

Writing style:
- Clear, plain, complete sentences. No em dashes. For ranges write "10 to 12". Sound like a sharp human analyst, not an AI.
- No filler: "it's worth noting", "drive the decision", "in today's landscape", forced parallel structure.
- Start with the answer. No process narration.
- Clean Markdown: short paragraphs, sentence-case headings, compact bullets.
- Use a Markdown table when comparing structured data across rows. Keep tables to 2-4 columns.
- No emojis, ASCII dividers, or all-caps labels.
- Analysis proportionate to the question. Do not revisit the same conclusion from multiple angles.

ARTIFACT PROTOCOL

When a chart, table, metric strip, or timeline would materially improve the answer — helping the user understand a pattern, comparison, composition, or progression faster than prose alone — emit it as a fenced artifact block at the exact point in the prose where it belongs:

\`\`\`artifact
{ ...valid JSON artifact spec... }
\`\`\`

Then continue the prose. The interface renders it inline automatically. Do not mention the block or tell the user a chart is coming. Do not add prose like "as you can see in the chart below".

Artifact kinds:

price-chart     Show price history for a ticker. Frontend fetches the data using ticker and period.
                Required: kind, title, ticker, period ("1M"|"3M"|"6M"|"1Y"|"2Y"|"3Y")
                Optional: overlay (["cost-basis","dividends","transactions","volume"]), description, fallback

bar-chart       Comparative values you supply directly in the spec.
                Required: kind, title, xKey (string), bars ([{key,label}]), data ([row objects])
                Optional: yUnit, description, fallback

comparison-table  Multi-row, multi-column comparison with data you embed.
                Required: kind, title, columns ([{key,label}]), rows ([row objects])
                Optional: description, fallback

metric-strip    Compact headline metrics you embed directly.
                Required: kind, metrics ([{label,value}])
                Optional: title, each metric may also have: delta (string), tone ("positive"|"negative"|"neutral"), detail

table           Scrollable data table — transactions, dividend history, filings, etc.
                Required: kind, title, columns ([{key,label,align?,format?}]), rows ([row objects])
                format options: "text" | "number" | "currency" | "percent" | "date"
                Optional: description, fallback

timeline        Sequence of dated events you embed directly.
                Required: kind, title, events ([{date,label,type}])
                type options: "filing"|"dividend"|"earnings"|"news"|"transaction"|"corporate"|"other"
                Optional per event: detail, value. Optional on spec: description, fallback

portfolio-attribution  Contribution or attribution breakdown you embed directly.
                Required: kind, title, items ([{label,value,percent?,tone?}])
                Optional: description, fallback

When to omit an artifact entirely:
- The answer contains only one or two values
- Prose already communicates the insight clearly
- The data is incomplete or would need to be invented
- A visual would just repeat what the prose already says
- The question is a simple factual lookup

For price-chart: only use tickers and periods supported by the platform. Never embed price history in the spec — the frontend fetches it. All other artifact kinds must contain only data you have from tools or the context block. Never fabricate rows, values, or events to fill a visual.`;

// Appended only for models that can actually call tools this turn.
const TOOL_RULE = `
Retrieval:
- Retrieve aggressively. You have tools for the user's whole-portfolio summary, individual positions, full holdings with sector weights, their own investment theses and journal entries, quotes, ratios, technicals, dividends, filings/news, market and sector performance, foreign flows, and the web. Use them proactively and chain as many as a complete answer needs — there is no penalty for extra lookups.
- Never give a generic answer when a tool could ground it in the user's real data. When a question touches WHY the user holds something, whether news/results change their view, conviction, concentration, income, or performance, call get_thesis / get_journal / get_portfolio_summary / list_holdings rather than guessing.
- If you decide to look something up, actually call the tool in the same turn. Never reply with only a promise like "let me check" or "give me a moment".`;

// Today's date in Pakistan time, so the model anchors "today"/"this week"/
// recency to the PSX trading day rather than its training cutoff. Computed per
// request (not at module load) so a long-lived server never serves a stale date.
function pktDateLine(): string {
  const today = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  return `Today's date is ${today} (Pakistan time). Interpret "today", "this week", and "recent" relative to this date, and treat anything materially older as not current news.`;
}

// Appended for tool-less models (e.g. DeepSeek R1): they cannot fetch, so they
// must answer from the pre-loaded <context> and never promise a lookup.
const NO_TOOL_RULE = `
Answering without tools:
- You cannot call tools on this turn. Answer using only the data in the <context> block.
- If the context already contains the answer (e.g. the user's holdings, value, sectors), use it directly.
- If something needed is genuinely missing, say plainly what's missing in one line. Never say you will "check", "pull", "look up", "fetch", or "give me a moment" — you cannot, so don't promise it.`;

type Evt =
  | { type: "thread"; thread: ChatThread }
  | { type: "cards"; cards: Card[] }
  | { type: "artifact"; spec: ArtifactSpec }
  | { type: "status"; text: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "reset" }
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

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    model?: string;
    threadId?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response(JSON.stringify({ error: "Empty message" }), { status: 400 });
  const modelDef = getModelDef(body.model);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Evt) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      let thread: ChatThread | null = null;
      let cards: Card[] = [];
      const artifactSpecs: ArtifactSpec[] = [];
      let assistantContent = "";
      let assistantThinking = "";
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
        const brief = briefFromCards(cards, latestSession);

        // 2. If the selected provider's AI is off, return a useful templated
        //    answer from the brief.
        const providerReady = modelDef.provider === "claude" ? claudeConfigured() : deepseekChatConfigured();
        if (!providerReady) {
          assistantContent = fallbackAnswer(message, brief, cards.length);
          send({ type: "text", delta: assistantContent });
          await persistAssistantTurn(supabase, user.id, thread.id, assistantContent, assistantThinking, cards);
          send({ type: "done" });
          controller.close();
          return;
        }

        // 3. Narrative. Tool-capable models get retrieval guidance; tool-less
        //    ones (DeepSeek R1) get the "answer from context, never promise a
        //    lookup" rule so they don't stall on a dangling promise.
        const canUseTools = modelDef.provider === "claude" || !!modelDef.supportsTools;
        const systemPrompt = `${SYSTEM_PROMPT}\n${pktDateLine()}\n${canUseTools ? TOOL_RULE : NO_TOOL_RULE}`;

        // The brief is injected so most questions answer in one shot (no extra
        // tool round-trips).
        let userContext = brief
          ? `<context>\n${brief}\n</context>\n\nQuestion: ${message}`
          : `Question: ${message}\n(No pre-loaded data matched — use tools to fetch what you need.)`;
        const trimmedHistory = (body.history ?? []).slice(-6);

        // Models that can't call tools (DeepSeek R1) can't web_search on their
        // own, so pre-fetch web context for "why did it move" questions and
        // inject it — gives them the same catalyst lookup the tool models get.
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
            (delta) => {
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
            const lastTurn = turn === MAX_TOOL_TURNS - 1;
            const turnStart = assistantContent.length;
            const mstream = claude.messages.stream({
              ...params,
              system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
              tools: CHAT_TOOLS,
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

            const final = await mstream.finalMessage();
            extractor.flush();
            if (final.stop_reason !== "tool_use") break;

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

            // Execute tools, append results, loop.
            const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
            messages.push({ role: "assistant", content: final.content });
            const results: Anthropic.ToolResultBlockParam[] = [];
            for (const tu of toolUses) {
              send({ type: "status", text: toolActivityLabel(tu.name) });
              const out = await executeTool(supabase, user.id, tu.name, (tu.input ?? {}) as Record<string, unknown>);
              results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
            }
            messages.push({ role: "user", content: results });
          }
        } else {
          // DeepSeek — same tools and brief, OpenAI-shaped streaming loop.
          const dsExtractor = new ArtifactExtractor(
            (delta) => {
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
        // invoking it (DeepSeek R1 with tools), replace the garbage answer.
        if (looksLikeToolLeak(assistantContent)) {
          send({ type: "reset" });
          assistantContent = TOOL_LEAK_FALLBACK;
          send({ type: "text", delta: assistantContent });
        }

        await persistAssistantTurn(supabase, user.id, thread.id, assistantContent, assistantThinking, cards, artifactSpecs);
        send({ type: "done" });
        controller.close();
      } catch (err) {
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

/** Deterministic answer when the LLM is disabled — uses the same digested numbers. */
function fallbackAnswer(message: string, brief: string, cardCount: number): string {
  if (!brief && cardCount === 0) {
    return "I couldn't find any matching PSX data for that. Try naming a ticker (e.g. MEBL) or asking about the market. (AI narration is currently turned off — the data cards above are live.)";
  }
  return `Here's what the live data shows:\n\n${brief}\n\n_(AI narration is turned off right now, so this is the raw data summary. Turn it back on to get an interpreted answer.)_`;
}
