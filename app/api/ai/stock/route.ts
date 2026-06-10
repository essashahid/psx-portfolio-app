import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { chatMarkdown, aiConfigured } from "@/lib/ai/openai";
import { getPortfolio } from "@/lib/portfolio";

export const maxDuration = 120;

type StockAction =
  | "thesis_check"
  | "summarize_news"
  | "find_risks"
  | "review_note"
  | "compare_thesis"
  | "attention";

const ACTION_PROMPTS: Record<StockAction, { title: string; prompt: string; saveToJournal?: boolean }> = {
  thesis_check: {
    title: "Thesis Check",
    prompt:
      "Compare the user's original investment thesis with the latest stored news and position data. State clearly: (1) which parts of the thesis recent information supports, (2) which parts it challenges, (3) whether anything 'may affect your thesis' and why, (4) what is missing to judge properly. Cite news source URLs. Suggest whether the thesis status (Active/Watch/Weakening/Broken) still looks appropriate — as an observation, not an instruction.",
  },
  summarize_news: {
    title: "News Summary",
    prompt:
      "Summarize the latest stored news for this stock. For each item: 1-2 sentence summary, sentiment from the holder's perspective, and the source URL. End with the single most important takeaway. If there is no stored news, say so and suggest refreshing from the News Center.",
  },
  find_risks: {
    title: "Risk Scan",
    prompt:
      "List the key risks for this position: risks the user already wrote in their thesis, plus risks visible in the stored news and position data (concentration, no price data, drift). For each risk give a one-line 'what to watch'. Do not invent risks with no basis in the context.",
  },
  review_note: {
    title: "Stock Review Note",
    prompt:
      "Write a structured review note for this position as of today: position summary, what changed recently (news, price vs targets), thesis health, open questions, and 'what to pay attention to next'. Keep it under 350 words.",
    saveToJournal: true,
  },
  compare_thesis: {
    title: "News vs Original Thesis",
    prompt:
      "Go point-by-point through the user's original thesis (why bought, expectation, risks, sell/reduce conditions, add conditions). For each point, state whether current stored news/data confirms it, contradicts it, or is silent. Cite URLs. Finish with the single biggest open question.",
  },
  attention: {
    title: "What to Watch Next",
    prompt:
      "Based on the thesis, targets, and stored news, list the 3-5 concrete things the user should pay attention to next for this stock (upcoming results, dividend dates implied by news, risk triggers from the thesis, price levels they set). Each with a one-line reason.",
  },
};

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured. Add it in .env.local to enable AI actions." },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as { ticker: string; action: StockAction };
    const action = ACTION_PROMPTS[body.action] ? body.action : "thesis_check";
    const ticker = (body.ticker ?? "").toUpperCase();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    const summary = await getPortfolio(supabase, user.id);
    const holding = summary.holdings.find((h) => h.ticker === ticker);
    if (!holding) return NextResponse.json({ error: `No holding found for ${ticker}` }, { status: 404 });

    const [{ data: thesis }, { data: target }, { data: news }, { data: journal }] =
      await Promise.all([
        supabase.from("theses").select("*").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
        supabase.from("targets").select("*").eq("user_id", user.id).eq("ticker", ticker).maybeSingle(),
        supabase
          .from("news_articles")
          .select("title, url, source, published_at, ai_summary, sentiment, relevance_score, category, snippet")
          .eq("user_id", user.id)
          .eq("ticker", ticker)
          .eq("ignored", false)
          .order("created_at", { ascending: false })
          .limit(12),
        supabase
          .from("journal_entries")
          .select("entry_date, entry_type, title, body")
          .eq("user_id", user.id)
          .eq("ticker", ticker)
          .order("entry_date", { ascending: false })
          .limit(8),
      ]);

    const context = [
      `# ${ticker} — ${holding.company_name ?? ""} (${holding.sector ?? "sector unknown"})`,
      `Position: ${holding.quantity} shares @ avg cost ${holding.avg_cost.toFixed(2)} (total cost ${holding.total_cost.toFixed(0)})`,
      `Latest price: ${holding.latest_price?.toFixed(2) ?? "MISSING — no price data"} ${holding.price_date ? `(as of ${holding.price_date}, source: ${holding.price_source})` : ""}`,
      `Market value: ${holding.market_value?.toFixed(0) ?? "unknown"} | Unrealized P/L: ${holding.unrealized_pl?.toFixed(0) ?? "unknown"} (${holding.unrealized_pl_pct?.toFixed(1) ?? "?"}%)`,
      `Portfolio weight: ${holding.weight?.toFixed(1) ?? "?"}% | Dividend income recorded: ${holding.dividend_income.toFixed(0)}`,
      `Targets: target price ${target?.target_price ?? "none"}, target allocation ${target?.target_allocation ?? "none"}%, review level ${target?.review_level ?? "none"}`,
      ``,
      `## Original thesis`,
      thesis
        ? [
            `Status: ${thesis.status} | Confidence: ${thesis.confidence ?? "?"}/5 | Review date: ${thesis.review_date ?? "none"}`,
            `Why bought: ${thesis.why_bought ?? "(blank)"}`,
            `Expectation: ${thesis.expectation ?? "(blank)"}`,
            `Time horizon: ${thesis.time_horizon ?? "(blank)"}`,
            `Key risks: ${thesis.key_risks ?? "(blank)"}`,
            `Sell/reduce conditions: ${thesis.sell_conditions ?? "(blank)"}`,
            `Add-more conditions: ${thesis.add_conditions ?? "(blank)"}`,
          ].join("\n")
        : "NO THESIS RECORDED — this is itself a gap worth flagging.",
      ``,
      `## Stored news (newest first)`,
      (news ?? []).length
        ? (news ?? [])
            .map(
              (n) =>
                `- ${n.title} [${n.sentiment ?? "?"}, relevance ${n.relevance_score ?? "?"}/10, ${n.category ?? "general"}] ${n.url}\n  ${n.ai_summary ?? n.snippet?.slice(0, 200) ?? ""}`
            )
            .join("\n")
        : "No stored news for this ticker.",
      ``,
      `## Recent journal entries`,
      (journal ?? []).length
        ? (journal ?? []).map((j) => `- ${j.entry_date} [${j.entry_type}] ${j.title}: ${(j.body ?? "").slice(0, 150)}`).join("\n")
        : "None.",
      ``,
      `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    ].join("\n");

    const def = ACTION_PROMPTS[action];
    const output = await logAgentRun(supabase, user.id, "stock_action", { ticker, action }, async () => {
      const { content, model } = await chatMarkdown(
        "You analyze a single stock position using only the provided context. Never fabricate news or prices.",
        `${def.prompt}\n\n--- CONTEXT ---\n${context}`,
        1600
      );

      const { data: saved, error: insErr } = await supabase
        .from("ai_briefings")
        .insert({
          user_id: user.id,
          briefing_type: "stock_review",
          ticker,
          title: `${def.title} — ${ticker}`,
          content,
          model,
          meta: { action },
        })
        .select("id, title, content, created_at")
        .single();
      if (insErr) throw insErr;

      if (def.saveToJournal) {
        await supabase.from("journal_entries").insert({
          user_id: user.id,
          ticker,
          entry_type: "hold_review",
          title: `AI review note — ${ticker} (${new Date().toISOString().slice(0, 10)})`,
          body: content,
          source: "ai",
        });
      }
      return { result: saved };
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
