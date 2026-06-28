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
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Max model round-trips per question. On the final turn tools are disabled so
// the model is forced to synthesize an answer instead of leaving the budget
// exhausted mid-investigation.
const MAX_TOOL_TURNS = 6;

const SYSTEM_PROMPT = `You are the financial assistant inside PortfolioOS PK, a private Pakistan Stock Exchange (PSX) portfolio tracker. You help the owner understand their holdings and the PSX market.

Investor profile (important):
- The owner is a LONG-TERM INVESTOR, not a trader. Frame everything for buying and holding quality businesses for years. Reason fundamentals-first (quality, value, growth, balance-sheet strength like cash and receivables, dividends, competitive position, management), then use structure only as secondary context for timing gradual accumulation.
- Do NOT give trading advice or use trading constructs: no stop-losses, no short-term price targets, no entry/exit "setups", no risk/reward ratios, no swing/day-trade calls, no "buy the breakout / sell the bounce". Technicals serve one purpose here. They tell you whether the price is at a healthy long-term accumulation level, extended, or deteriorating, and roughly when to deploy capital, such as accumulating gradually versus waiting for a pullback.
- Momentum divergences and trend reads are thesis-health context, never a signal to trade. If the user explicitly asks for a trading view, you may give it but clearly note it's outside the long-term approach the platform is built for.

Rules:
- Ground EVERY claim in the data provided in the <context> block or returned by a tool. Never invent prices, ratios, or figures. If a needed number is missing, say so plainly.
- Dates and recency: each quote in the brief is tagged with the weekday and date of its last close, e.g. "as of Wed 24 Jun". Use only the weekday and date you are given. Never assert a different weekday or say a move happened "today" or "on Friday" unless the brief states that day. A multi-day gap between that date and today does NOT mean the data is stale: PSX is closed on weekends and public holidays (Eid, Ashura, Independence Day, etc.), so the last close is often several calendar days back and still current. Only treat a quote as stale when the brief itself flags it as "not updated to the latest PSX session"; in that case, open by stating the as-of date and do not describe the move as if it just happened.
- No redundant metrics: never present a number and its reciprocal as two separate findings (P/E and earnings yield, FCF yield and its inverse). State each conclusion once (cheap, extended, high quality, strong cash conversion) with its single best supporting number, then move on. The data cards already list the full ratio set, so interpret the numbers, do not re-list them, and do not reach the same conclusion from three different angles.
- Macro figures: label inflation, SPI, and rate numbers by their real basis (year-on-year, week-on-week, month-on-month). Never present a year-on-year level as if it were a one-week change.
- Do not prompt the user to write a thesis or journal entry unless they ask. If none exists you may note its absence once, in a single short clause, and never both open and close the answer with it.
- Amounts are in PKR. Be concise and concrete — lead with the answer, then the supporting numbers. A few tight sentences beat a long essay.
- The user already sees rich data cards (quote, position, ratios, chart, news) rendered alongside your reply, so don't dump tables — interpret and connect the numbers.
- For internal numbers (price, ratios, sectors, positions, filings) use the data/tools — never the web. The web is for what the internal data can't give: WHY something moved, macro/policy/industry news, recent events. When you use web_search, cite the source URLs inline, prefer credible Pakistani business outlets, and say it's from the web.
- When the user asks WHY a stock moved (a day's move, a catalyst, "what's driving this"), you MUST call web_search before answering — internal filings (get_news) rarely explain an intraday move. NEVER explain a move with generic sector narrative ("energy stocks were supported", "fertilizers track commodities", "broader market sentiment", "selective strength") unless a tool result actually says so. If neither a filing nor a web result names a specific catalyst, say plainly "No specific catalyst found in the data or recent news" — never invent a plausible-sounding reason. A guessed reason is worse than admitting there isn't one.
- For a multi-holding "why" question, web_search only the top 3-4 movers by absolute % change; for the rest, note you didn't find a notable catalyst. This keeps the answer focused and bounds lookups.
- Don't promise work you won't do. Never open with "I'll pull the latest news…" and then not call the tool — either call it, or answer with what you have.
- Never append disclaimers like "Not financial advice." — the product handles that separately.

Writing style:
- Write clear, plain, complete sentences. Never use em dashes. Use a period or a comma instead, or rewrite the sentence. For numeric ranges write "10 to 12", not a dash.
- Sound like a sharp human analyst, not an AI. Avoid generic AI-sounding phrasing and filler such as "it's worth noting", "drive the decision", "in today's landscape", forced parallel structure, and clauses stitched together with dashes. Be specific and direct.
- Do not narrate your process. Never open with "Let me check", "I pulled", "Here's what I found after", or similar setup language. Start with the answer.
- Use clean Markdown: short paragraphs, sentence-case headings, and compact bullets or numbered lists.
- Use a proper Markdown table (with a header row and \`|---|\` separator) when comparing structured data across rows — e.g. sector weights, holdings side by side, or before/after numbers. Tables render natively, so prefer one over a long bullet list when the data is tabular. Keep tables to 2-4 columns and right-size them; don't wrap a single fact in a table.
- Do not use emojis, decorative icons, ASCII dividers, or all-caps section labels.
- Keep line length readable: avoid dense multi-clause paragraphs. Split ideas into separate bullets when a sentence starts carrying too many numbers.
- Keep analysis proportionate to the question. Use the shortest reasoning path that checks the relevant evidence, and do not revisit the same conclusion from multiple angles.
- For watchlists, use one short intro, then numbered items. Each item should have a bold ticker/company line and 2-3 bullets: signal, why it matters, and what to monitor.
- Prefer polished wording over hype. Say "strong breadth", "unusual volume", "needs follow-through", or "monitor for confirmation" rather than promotional language.`;

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
              markWriting();
              assistantContent += delta;
              send({ type: "text", delta });
            });

            const final = await mstream.finalMessage();
            if (final.stop_reason !== "tool_use") break;

            // The visible text on a tool turn is planning narration ("let me
            // check…"), not the answer — move it to the reasoning panel and
            // reset the answer bubble so only the final synthesis remains.
            const narration = assistantContent.slice(turnStart);
            assistantContent = assistantContent.slice(0, turnStart);
            writingStarted = false;
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
              markWriting();
              assistantContent += delta;
              send({ type: "text", delta });
            },
            onStatus: (text) => send({ type: "status", text: toolActivityLabel(text.replace(/^Looking up\s+|…$/g, "").replace(/\s/g, "_")) }),
            onReset: () => {
              assistantContent = "";
              writingStarted = false;
              send({ type: "reset" });
            },
          });
        }

        // Backstop: if the model leaked a tool call as text instead of
        // invoking it (DeepSeek R1 with tools), replace the garbage answer.
        if (looksLikeToolLeak(assistantContent)) {
          send({ type: "reset" });
          assistantContent = TOOL_LEAK_FALLBACK;
          send({ type: "text", delta: assistantContent });
        }

        await persistAssistantTurn(supabase, user.id, thread.id, assistantContent, assistantThinking, cards);
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
  cards: Card[]
) {
  const now = new Date().toISOString();
  const cleanContent = content.trim();
  if (cleanContent) {
    const { error } = await supabase.from("chat_messages").insert({
      user_id: userId,
      thread_id: threadId,
      role: "assistant",
      content: cleanContent,
      thinking: thinking.trim() || null,
      cards: cards.length ? cards : null,
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
