import { requireUser } from "@/lib/api-helpers";
import { resolveMessage } from "@/lib/chat/resolver";
import { gatherCards, briefFromCards, type Card } from "@/lib/chat/context";
import { CHAT_TOOLS, executeTool } from "@/lib/chat/tools";
import { claudeConfigured, getClaude, buildRequestParams, type ChatLevel } from "@/lib/ai/claude";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are the financial assistant inside PortfolioOS PK, a private Pakistan Stock Exchange (PSX) portfolio tracker. You help the owner understand their holdings and the PSX market.

Rules:
- You are NOT a financial advisor. NEVER recommend buying, selling, or holding, and never use those words as advice. Use neutral framing: "worth monitoring", "this affects the thesis", "looks stretched on this metric".
- Ground EVERY claim in the data provided in the <context> block or returned by a tool. Never invent prices, ratios, or figures. If a needed number is missing, say so plainly.
- Amounts are in PKR. Be concise and concrete — lead with the answer, then the supporting numbers. A few tight sentences beat a long essay.
- The user already sees rich data cards (quote, position, ratios, chart, news) rendered alongside your reply, so don't dump tables — interpret and connect the numbers.
- Call a tool only when the <context> block lacks something you need (e.g. a second company to compare, or data for a ticker not yet loaded).
- For internal numbers (price, ratios, sectors, positions, filings) use the data/tools — never the web. Use web_search only for things the internal data can't give: WHY something moved, macro/policy/industry news, recent events. When you use web_search, cite the source URLs inline and prefer credible Pakistani business outlets; say it's from the web, and note it may be less precise than the official PSX data.
- Never append disclaimers like "Not financial advice." — the product handles that separately.

Writing style:
- Do not narrate your process. Never open with "Let me check", "I pulled", "Here's what I found after", or similar setup language. Start with the answer.
- Use clean Markdown only: short paragraphs, sentence-case headings, and compact bullets or numbered lists.
- Do not use emojis, decorative icons, ASCII dividers, horizontal rules, pipe-separated pseudo tables, or all-caps section labels.
- Keep line length readable: avoid dense multi-clause paragraphs. Split ideas into separate bullets when a sentence starts carrying too many numbers.
- For watchlists, use one short intro, then numbered items. Each item should have a bold ticker/company line and 2-3 bullets: signal, why it matters, and what to monitor.
- Prefer polished wording over hype. Say "strong breadth", "unusual volume", "needs follow-through", or "monitor for confirmation" rather than promotional language.`;

type Evt =
  | { type: "thread"; thread: ChatThread }
  | { type: "cards"; cards: Card[] }
  | { type: "status"; text: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
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
    level?: ChatLevel;
    threadId?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response(JSON.stringify({ error: "Empty message" }), { status: 400 });
  const level: ChatLevel = body.level ?? "standard";

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
        const resolved = await resolveMessage(supabase, message);
        cards = await gatherCards(supabase, user.id, resolved);
        if (cards.length) send({ type: "cards", cards });
        const brief = briefFromCards(cards);

        // 2. If AI is off, return a useful templated answer from the brief.
        if (!claudeConfigured()) {
          assistantContent = fallbackAnswer(message, brief, cards.length);
          send({ type: "text", delta: assistantContent });
          await persistAssistantTurn(supabase, user.id, thread.id, assistantContent, assistantThinking, cards);
          send({ type: "done" });
          controller.close();
          return;
        }

        // 3. Claude narrative with tools. The brief is injected so most
        //    questions answer in one shot (no extra tool round-trips).
        const claude = getClaude();
        const params = buildRequestParams(level, level === "deep" ? 2200 : 1500);
        const userContext = brief
          ? `<context>\n${brief}\n</context>\n\nQuestion: ${message}`
          : `Question: ${message}\n(No pre-loaded data matched — use tools to fetch what you need.)`;
        const messages: Anthropic.MessageParam[] = [
          ...(body.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: userContext },
        ];

        for (let turn = 0; turn < 4; turn++) {
          const mstream = claude.messages.stream({
            ...params,
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            tools: CHAT_TOOLS,
            messages,
          } as Anthropic.MessageCreateParamsStreaming);

          mstream.on("thinking", (delta: string) => {
            assistantThinking += delta;
            send({ type: "thinking", delta });
          });
          mstream.on("text", (delta: string) => {
            assistantContent += delta;
            send({ type: "text", delta });
          });

          const final = await mstream.finalMessage();
          if (final.stop_reason !== "tool_use") break;

          // Execute tools, append results, loop.
          const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          messages.push({ role: "assistant", content: final.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ type: "status", text: `Looking up ${tu.name.replace(/_/g, " ")}…` });
            const out = await executeTool(supabase, user.id, tu.name, (tu.input ?? {}) as Record<string, unknown>);
            results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
          }
          messages.push({ role: "user", content: results });
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
