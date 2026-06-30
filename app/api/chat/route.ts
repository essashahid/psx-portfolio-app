import { requireUser } from "@/lib/api-helpers";
import { accountHasFeature, normalizeAllowedChatProviders } from "@/lib/features";
import { rejectDemoWrite } from "@/lib/demo-mode";
import { resolveMessage } from "@/lib/chat/resolver";
import { gatherCards, briefFromCards, briefFromPositionHistory, briefFromHoldingsSummary, briefFromThesisJournal, briefFromPortfolioPatterns, type Card } from "@/lib/chat/context";
import { getLatestSessionDate, getPositionHistoryCard, getHoldingsSummary, getDecisionNotes, type HoldingsSummary } from "@/lib/chat/data";
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

// Soft wall-clock budget for tool exploration. The hosting platform hard-kills
// the function at its plan limit (60s on Vercel Hobby, up to `maxDuration` on
// Pro). When that happens mid-stream the client sees all the stages but never an
// answer. Before we get close, we stop calling tools and force the model to
// synthesize from whatever it has gathered, so a real answer streams within
// budget. Defaults to maxDuration minus headroom for the final write; override
// per-plan with CHAT_DEADLINE_MS (e.g. 45000 on Hobby).
const SYNTHESIS_DEADLINE_MS = Number(process.env.CHAT_DEADLINE_MS) || (maxDuration - 25) * 1000;

const SYSTEM_PROMPT = `You are the Research Copilot inside PortfolioOS PK, a private Pakistan Stock Exchange (PSX) portfolio intelligence platform. You answer questions about the owner's real holdings and PSX companies with the depth and precision of a senior buy-side analyst who already knows this portfolio cold. Every answer must read as something only a system with full access to this exact portfolio could write, never as generic market commentary.

Operating principles (read first):
- The <context> block is your evidence. It carries pre-computed, verified figures: holdings and weights, sector concentration, cross-holding patterns, cash, net worth, transaction tranches, blended-cost evolution, exact addition and allocation scenarios, the user's own thesis and journal, quotes, ratios, technicals, dividends, filings, and market data. Treat every number there as ground truth.
- Narrate, never calculate. The platform has already computed weights, allocation impact, average cost, sector concentration, and add-scenarios. Quote those figures exactly and use scenario-table rows verbatim. Do not redo the arithmetic or estimate what is already given.
- Use what you have, with confidence. Answer from the evidence in front of you. Do not write "I don't have", "without your full data", "I cannot calculate", or a "what's missing" section, and do not hedge a clear read into vagueness. If a single input that would genuinely flip the recommendation is absent, name it in one short clause and move on. Never lead with limitations. The platform shows the legal disclaimer, so never add "not financial advice".
- Be specific and pattern-aware. Every sentence about the portfolio must carry a real figure from <context>: a weight, a PKR amount, a tranche price, a yield, a sector share. Connect facts across holdings rather than analysing one in isolation. A sentence about the user's money that contains no number from <context> is a failure, and so is anything a generic LLM could have written without seeing this portfolio.
- Lead with the answer. State your view in the first two or three sentences, then support it.

Who you advise:
- A LONG-TERM INVESTOR. Reason fundamentals-first: quality, value, growth, balance-sheet strength, dividends, competitive position, management.
- No trading constructs: no stop-losses, price targets, entry/exit setups, risk/reward ratios, or swing calls. Technicals answer one question only: is the price an attractive level for gradual long-term accumulation, extended, or deteriorating. Momentum and trend are thesis-health context, never trade signals.

Depth — decide silently before writing:
- Concise for a lookup or single number. Moderate for one company or event. Comprehensive only when the question needs multiple sources, scenario work, or a full portfolio assessment. Match length to the question and never inflate. Always finish the conclusion and decision conditions within the budget; when space is tight, compress prose and prefer tables; never stop mid-section.

Decision questions (add, buy more, average up or down, trim, hold, sell, size):
- Open with a 2 to 3 sentence verdict the user grasps in ten seconds: clear, specific to their book, decisive.
- Then make two distinct cases:
  - Company case: fundamentals, valuation on available earnings, earnings quality (revenue versus margins versus one-offs versus input costs), timeliness, key risks.
  - Portfolio case: current position weight, sector weight, how the addition shifts both, overlap with existing holdings, cash use, and alternative uses of the same capital. A strong company can still be a poor addition to a concentrated book; never recommend on company merit alone.
- Use the pre-computed addition-scenario table for the amount the user gave (shares, new average cost, new weight, sector weight after, cash after). If no amount was given, use the provided scenarios or state the view is conditional on size.
- Read the verified transaction tranches directly: say whether early low-price lots carry the blended average and whether recent lots bought in near the current price, so the margin of safety on new money is thinner than the headline gain implies. Derive this from the actual rows, never from a template.
- Close with explicit conditions: "Adding is more defensible if: [2 to 4 evidence-backed]" and "Waiting is more defensible if: [2 to 4 evidence-backed]". Do not force a buy, hold, or sell label when the evidence genuinely does not support one.

Cross-holding intelligence (this is the product's edge):
- Whenever the context includes the wider portfolio, surface the connections a generic model could never see: positions that share a sector or risk driver, concentration a new buy would worsen, holdings whose theses overlap, idle cash that is a drag, a sector with no exposure, or one position's outlook bearing on another. If the context provides a portfolio-patterns block, build on it. Lead the user to insights about their book as a whole, not just the single name they asked about.

Accuracy (non-negotiable, and not a reason to hedge):
- Never invent a price, ratio, figure, transaction, filing, dividend, or news item. If it is not in <context> or a tool result, do not state it. Accuracy is the foundation; vagueness is not.
- Flag verified-versus-user-entered or derived data only when it changes the conclusion (for example a quantity discrepancy); do not annotate every number with its source.
- For quantity discrepancies, rank explanations by evidence ("most likely", "possible", "unresolved"); if a difference matches a known transaction, say so.
- Do not claim a moat, "well-run", low-cost producer, brand, distribution edge, audited status, peer or historical valuation comparison, or dividend growth unless the evidence is present. When ratios are strong, state what they show without inventing a durable advantage. Do not treat one year's growth as sustainable without its drivers, or an unrelated ratio pair such as P/E versus ROE as proof of cheapness.

Data handling:
- Amounts are PKR. Each quote is tagged with its last close date; PSX closes on weekends and Pakistani holidays, so a multi-day-old close can still be current. Treat a quote as stale only when the brief flags it.
- Internal numbers (prices, ratios, positions, filings) come from <context> and tools, never the web. Use web_search only for WHY something moved or for macro, policy, and industry news, and cite credible Pakistani sources. When asked why a stock moved, search before answering; if no specific catalyst is found, say so plainly rather than inventing a narrative. Never open with "let me check" or promise a lookup you will not perform.
- Label macro figures by their real basis (year-on-year, week-on-week, month-on-month).

Technicals and metrics:
- RSI near 70 is "elevated momentum", near 30 "depressed momentum"; it is a momentum read, not a valuation measure or a standalone signal.
- Show only decision-relevant metrics, grouped: valuation (P/E, FCF yield), strength (net debt/equity, interest coverage), profitability (ROIC, margin trend), cash quality (OCF/PAT, dividend cover), momentum (RSI, shown apart from fundamentals). A 4 to 6 metric strip beats a wall of ratios. State each conclusion once with its single best number; never give a figure and its reciprocal as two findings.

Writing style:
- Plain, complete sentences. No em dashes; write ranges as "10 to 12". Sound like a sharp human analyst, not an AI.
- Start with the answer, no process narration. No filler ("it's worth noting", "in today's landscape"). No emojis, ASCII dividers, or all-caps labels.
- Clean Markdown: short paragraphs, sentence-case headings, compact bullets, tables of 2 to 4 columns for structured comparisons. Keep analysis proportionate; never restate the same conclusion from several angles.

Visualizations:
- A great answer pairs a sharp narrative with the one or two visuals that make a pattern obvious. For a decision, prefer the allocation-impact table, the cost-basis or tranche table, a price chart with cost, dividend, and transaction overlays, or a concentration breakdown over a generic ratio grid. Use a visual only when it shows something the prose cannot, and never repeat the same data in both prose and chart. See ARTIFACT PROTOCOL below.

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

// Appended for any tool-less model (none ship today — DeepSeek moved to V4
// Flash with tools): they cannot fetch, so they must answer from the pre-loaded
// <context> and never promise a lookup. Kept for a future tool-less model.
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
        const proposedAmount = extractProposedPkrAmount(message);
        const isDecision = resolved.intent === "position" && resolved.tickers.length > 0;
        const positionHistoryBriefs = isDecision
          ? await Promise.all(
              resolved.tickers.slice(0, 2).map(async (ticker) => {
                const history = await getPositionHistoryCard(supabase, user.id, ticker, proposedAmount);
                return briefFromPositionHistory(history);
              })
            )
          : [];

        // Whole-portfolio context. For a single-ticker decision, hand the model
        // the full holdings + the user's own thesis/journal (pre-computed), so the
        // concentration case is specific ("fertilizer is 24% of your book") and
        // there is no excuse to say portfolio data is missing. For any
        // portfolio-aware question, also inject pre-computed cross-holding
        // patterns so the model reasons across the whole book.
        let decisionContext = "";
        let patternsBrief = "";
        {
          const holdingsCard = cards.find((c) => c.kind === "holdings");
          let holdingsData: HoldingsSummary | null =
            holdingsCard && holdingsCard.kind === "holdings" ? holdingsCard.data : null;
          if (isDecision) {
            const [hs, notes] = await Promise.all([
              holdingsData ? Promise.resolve(holdingsData) : getHoldingsSummary(supabase, user.id),
              getDecisionNotes(supabase, user.id, resolved.tickers[0]),
            ]);
            holdingsData = hs;
            decisionContext = [
              // Skip the holdings table here if it is already rendered as a card.
              holdingsCard ? "" : hs ? briefFromHoldingsSummary(hs) : "",
              briefFromThesisJournal(notes, resolved.tickers[0]),
            ].filter(Boolean).join("\n\n");
          }
          if (holdingsData) patternsBrief = briefFromPortfolioPatterns(holdingsData);
        }

        const brief = [briefFromCards(cards, latestSession), ...positionHistoryBriefs, decisionContext, patternsBrief]
          .filter(Boolean)
          .join("\n\n");

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

        // 3. Narrative. Tool-capable models get retrieval guidance; any
        //    tool-less model gets the "answer from context, never promise a
        //    lookup" rule so it doesn't stall on a dangling promise.
        const canUseTools = modelDef.provider === "claude" || !!modelDef.supportsTools;
        const budgetNote = tokenBudgetNote(modelDef.maxTokens, message);
        const systemPrompt = `${SYSTEM_PROMPT}\n${pktDateLine()}${budgetNote}\n${canUseTools ? TOOL_RULE : NO_TOOL_RULE}`;

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
