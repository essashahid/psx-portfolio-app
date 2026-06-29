import { requireUser } from "@/lib/api-helpers";
import { resolveMessage } from "@/lib/chat/resolver";
import { gatherCards, briefFromCards, briefFromPositionHistory, type Card } from "@/lib/chat/context";
import { getLatestSessionDate, getPositionHistoryCard } from "@/lib/chat/data";
import { CHAT_TOOLS, CLAUDE_TOOLS, executeTool } from "@/lib/chat/tools";
import { claudeConfigured, getClaude, buildClaudeParams } from "@/lib/ai/claude";
import { deepseekChatConfigured, runDeepSeekChat } from "@/lib/ai/deepseek-chat";
import { getModelDef } from "@/lib/ai/models";
import { looksLikeToolLeak, TOOL_LEAK_FALLBACK } from "@/lib/chat/sanitize";
import { wantsWebContext, gatherWebContext } from "@/lib/chat/web-context";
import { ArtifactExtractor, type ArtifactSpec } from "@/lib/chat/artifacts";
import {
  emptyMeta, normalizeStopReason, validateResponseCompletion,
  buildContinuationPrompt, tokenBudgetNote,
  type GenerationMeta,
} from "@/lib/chat/completion";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
Never use the full token budget unless it improves the answer. Always complete the conclusion, risks, portfolio implications, and data limitations within the available limit. Never stop mid-sentence or mid-section. If approaching the limit, compress supporting prose, prefer tables over verbose descriptions, and always preserve the conclusion.

Decision questions:
- For questions like "should I buy more", "should I add", "should I trim/sell/wait": begin with a 2-3 sentence provisional conclusion. The user should understand your preliminary view within 10 seconds. The conclusion must be clear, conditional, evidence-based, specific to their portfolio, and qualified where data is missing.
- Then present the supporting evidence, separated into company case and portfolio case.
- End with a clear final assessment and explicit decision conditions.

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

Existing-holding and add-more decisions:
- If the user asks whether to add, buy more, average up/down, trim, hold, size, or review an existing position, always evaluate TWO distinct questions:

  Company case: Are fundamentals attractive? Is valuation supported by available evidence? Is earnings quality acceptable (revenue growth vs. one-time items vs. margin expansion)? What risks affect the company? Is current evidence timely?

  Portfolio case: Current portfolio weight? Current sector weight? How does adding change concentration? Does the portfolio already contain similar exposures? Available capital? Alternative uses? Does the addition fit position-size limits?

  A strong company can still be an inappropriate addition to an already concentrated portfolio. Do not issue an add recommendation based only on company ratios.
- Before saying portfolio allocation, cash, or quantity history is unavailable, inspect the available position, holdings, whole-portfolio summary, cash balance, sector weights, transaction ledger, broker reconciliation checkpoint, thesis and journal. With tools, call get_position_history plus get_portfolio_summary/list_holdings/get_thesis/get_journal as needed. Without tools, use any DECISION EVIDENCE in <context>.
- Do not evaluate a new buy against blended average cost alone. Use the verified transaction rows to identify purchases, sales, fees, cost-basis evolution, source mix, quantity discrepancies, and whether recent tranches had materially less margin of safety than early tranches.
- If the user gives an add amount, calculate that exact scenario. If not, use the provided add-size scenarios or state that the answer is conditional on sizing. Show shares, new average cost, new position weight, sector-weight impact, cash use and any external capital needed before recommending an addition.
- Prefer decision artifacts that match the question: transaction-history table, cost-basis evolution table, allocation-impact table, position summary strip, price chart with cost/dividend/transaction overlays, or concentration visual. Do not use a headline ratio grid as the main evidence for an add-more decision.

Purchase-tranche analysis:
- For existing positions with multiple purchase tranches at different prices, identify and explain: whether early low-price purchases are carrying the blended average, whether recent purchases were close to the current price, and whether the blended average creates a misleading impression of margin of safety for new money.
- Express this concretely: "Your blended average cost is heavily supported by the original low-price tranche. Most recent purchases were close to the current price, so the margin of safety on new money is much smaller than the overall unrealized gain implies."
- Do not hardcode this for every stock. Derive it from the actual purchase tranches.

Allocation impact:
- For buy-more questions, the allocation impact is more important than a grid of financial ratios. Calculate: estimated shares at current price, new total shares and new average cost, new position value, current and new portfolio weight, current and new sector weight, and cash remaining after purchase.
- Show this as a metric-strip or small table, not buried in prose.

Data confidence:
- Label data sources explicitly in your analysis:
  - "Broker verified" for data from broker statement imports
  - "User entered" or "platform recorded" for manual transactions not yet confirmed by a broker statement
  - "Derived" for calculated figures (e.g., current quantity = broker snapshot + post-checkpoint transactions)
  - "Pending confirmation" for user-entered trades awaiting next broker statement
- Do not label user-entered transactions as "verified" until confirmed by broker statement, trade confirmation, or CDC record.
- When presenting a transaction table, include a Source or Status column.

Discrepancy reasoning:
- When identifying quantity discrepancies, rank explanations by evidence. If the difference exactly matches a known transaction, state that as the most likely explanation. Use "most likely", "possible", "unlikely", "unresolved" rather than presenting all explanations equally. Do not claim certainty without verification.

Financial claim discipline:
- Do not describe a company as "well-run", "high quality", "a strong franchise", "a low-cost producer", or "a strong brand" unless you have specific evidence beyond financial ratios. Better: "The financial data indicates strong cash generation and low leverage, but does not by itself establish a durable competitive advantage."
- Do not claim the market is mispricing something or compare to historical averages unless actual comparison data is present. Better: "The current multiple appears moderate on available earnings, but the evidence does not establish whether it is cheap relative to normalized earnings, peers, or history."
- Do not assume one year's profit growth is sustainable without evaluating its drivers (revenue growth, margin expansion, other income, one-time items, input costs).
- Avoid unsupported claims: no market-average valuation comparisons, peer comparisons, audited-status claims, low-cost-producer/brand/distribution claims, dividend-growth claims, buyback/expansion optionality, sector outlook, book-value downside anchors, or original-thesis confirmation unless the specific evidence is present. Do not compare unrelated ratios such as P/E versus ROE as if the numerical relationship proves cheapness.

Technical indicators:
- An RSI near 70 should be described as "elevated momentum" or "approaching the overbought threshold", not "overbought". An RSI near 30 is "depressed momentum" or "approaching oversold". RSI is a momentum indicator, not a valuation measure. Do not treat it as a buy or sell signal by itself.

Metric presentation:
- When presenting financial metrics, show only the most decision-relevant ones. Group related metrics:
  - Valuation: P/E, FCF yield
  - Financial strength: Net debt/equity, interest coverage
  - Profitability: ROIC, margin trend
  - Cash quality: OCF/PAT, dividend cover
  - Momentum: RSI (visually separate from fundamentals)
- Use a metric-strip with 4-6 key metrics rather than 8+ dense cards. Do not give equal visual weight to all metrics.

Recommendation language:
- Do not issue a recommendation merely because the user has a gain, the company has low debt, P/E appears low, or FCF yield appears high. The final assessment must explain: why adding may make sense, why waiting may make sense, whether the portfolio is already sufficiently exposed, how recent purchases affect margin of safety, what evidence is missing, and what allocation level would become excessive.
- Every decision answer must include concise conditions:
  - "Adding becomes more defensible if: [2-4 specific, evidence-backed conditions]"
  - "Waiting becomes more defensible if: [2-4 specific, evidence-backed conditions]"
  Select only conditions supported by available evidence.
- Do not force a buy, hold, or sell label when evidence is insufficient.

Artifact token efficiency:
- Do not repeat the same data in prose, table rows, chart payload, and metadata. State a figure once in the most useful format and move on. Use compact artifact specs. If the prose already explains the insight, do not also create a chart that shows the same thing.

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
        const proposedAmount = extractProposedPkrAmount(message);
        const positionHistoryBriefs =
          resolved.intent === "position" && resolved.tickers.length
            ? await Promise.all(
                resolved.tickers.slice(0, 2).map(async (ticker) => {
                  const history = await getPositionHistoryCard(supabase, user.id, ticker, proposedAmount);
                  return briefFromPositionHistory(history);
                })
              )
            : [];
        const brief = [briefFromCards(cards, latestSession), ...positionHistoryBriefs].filter(Boolean).join("\n");

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
        const budgetNote = tokenBudgetNote(modelDef.maxTokens, message);
        const systemPrompt = `${SYSTEM_PROMPT}\n${pktDateLine()}${budgetNote}\n${canUseTools ? TOOL_RULE : NO_TOOL_RULE}`;

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

              if (
                meta.stopReason === "length" &&
                (meta.completionStatus === "definitely_incomplete" || meta.completionStatus === "possibly_incomplete")
              ) {
                // Auto-continuation: up to 2 attempts.
                const MAX_CONTINUATIONS = 2;
                for (let ci = 0; ci < MAX_CONTINUATIONS; ci++) {
                  meta.continuationTriggered = true;
                  meta.continuationCount++;
                  send({ type: "status", text: "Completing the response" });
                  const contPrompt = buildContinuationPrompt(message, assistantContent, modelDef.maxTokens);
                  const contMessages: Anthropic.MessageParam[] = [
                    ...messages,
                    { role: "assistant", content: final.content },
                    { role: "user", content: contPrompt },
                  ];
                  const contStream = claude.messages.stream({
                    ...params,
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
                  if (meta.completionStatus === "complete" || meta.stopReason === "complete") break;
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

function extractProposedPkrAmount(message: string): number | null {
  const text = message.toLowerCase().replace(/,/g, "");
  const suffixMultiplier = (suffix: string | undefined) => {
    if (!suffix) return 1;
    if (suffix === "k") return 1_000;
    if (suffix === "m" || suffix === "mn" || suffix === "million") return 1_000_000;
    if (suffix === "lac" || suffix === "lakh") return 100_000;
    if (suffix === "crore") return 10_000_000;
    return 1;
  };
  const patterns = [
    /(?:pkr|rs\.?|rupees?)\s*(\d+(?:\.\d+)?)\s*(k|m|mn|million|lac|lakh|crore)?\b/,
    /\b(\d+(?:\.\d+)?)\s*(k|m|mn|million|lac|lakh|crore)?\s*(?:pkr|rs\.?|rupees?)\b/,
    /\b(\d+(?:\.\d+)?)\s*(k|m|mn|million|lac|lakh|crore)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const amount = Number(match[1]) * suffixMultiplier(match[2]);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
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
