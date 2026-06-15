import { requireUser } from "@/lib/api-helpers";
import { resolveMessage } from "@/lib/chat/resolver";
import { gatherCards, briefFromCards, type Card } from "@/lib/chat/context";
import { CHAT_TOOLS, executeTool } from "@/lib/chat/tools";
import { claudeConfigured, getClaude, buildRequestParams, type ChatLevel } from "@/lib/ai/claude";
import type Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are the financial assistant inside PortfolioOS PK, a private Pakistan Stock Exchange (PSX) portfolio tracker. You help the owner understand their holdings and the PSX market.

Rules:
- You are NOT a financial advisor. NEVER recommend buying, selling, or holding, and never use those words as advice. Use neutral framing: "worth monitoring", "this affects the thesis", "looks stretched on this metric".
- Ground EVERY claim in the data provided in the <context> block or returned by a tool. Never invent prices, ratios, or figures. If a needed number is missing, say so plainly.
- Amounts are in PKR. Be concise and concrete — lead with the answer, then the supporting numbers. A few tight sentences beat a long essay.
- The user already sees rich data cards (quote, position, ratios, chart, news) rendered alongside your reply, so don't dump tables — interpret and connect the numbers.
- Call a tool only when the <context> block lacks something you need (e.g. a second company to compare, or data for a ticker not yet loaded).
- End with a one-line "Not financial advice." only when you've given an assessment.`;

type Evt =
  | { type: "cards"; cards: Card[] }
  | { type: "status"; text: string }
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    level?: ChatLevel;
    history?: { role: "user" | "assistant"; content: string }[];
  };
  const message = (body.message ?? "").trim();
  if (!message) return new Response(JSON.stringify({ error: "Empty message" }), { status: 400 });
  const level: ChatLevel = body.level ?? "standard";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Evt) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        // 1. FREE layer — resolve, gather cards, render immediately.
        const resolved = await resolveMessage(supabase, message);
        const cards = await gatherCards(supabase, user.id, resolved);
        if (cards.length) send({ type: "cards", cards });
        const brief = briefFromCards(cards);

        // 2. If AI is off, return a useful templated answer from the brief.
        if (!claudeConfigured()) {
          send({ type: "text", delta: fallbackAnswer(message, brief, cards.length) });
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

          mstream.on("thinking", (delta: string) => send({ type: "thinking", delta }));
          mstream.on("text", (delta: string) => send({ type: "text", delta }));

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

/** Deterministic answer when the LLM is disabled — uses the same digested numbers. */
function fallbackAnswer(message: string, brief: string, cardCount: number): string {
  if (!brief && cardCount === 0) {
    return "I couldn't find any matching PSX data for that. Try naming a ticker (e.g. MEBL) or asking about the market. (AI narration is currently turned off — the data cards above are live.)";
  }
  return `Here's what the live data shows:\n\n${brief}\n\n_(AI narration is turned off right now, so this is the raw data summary. Turn it back on to get an interpreted answer.)_`;
}
