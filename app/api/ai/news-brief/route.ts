import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { aiAvailable } from "@/lib/ai/openai";
import { taskText } from "@/lib/ai/tasks";
import { getClaude, claudeConfigured, buildClaudeParams } from "@/lib/ai/claude";
import { getModelDef } from "@/lib/ai/models";

export const maxDuration = 120;

type BriefModel = "deepseek" | "claude-sonnet" | "claude-opus";

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as { model?: BriefModel };
  const model: BriefModel = body.model ?? "deepseek";
  const useClaude = model === "claude-sonnet" || model === "claude-opus";

  if (useClaude && !claudeConfigured()) {
    return NextResponse.json({ error: "Claude is not configured. Add CLAUDE_API_KEY in .env.local." }, { status: 503 });
  }
  if (!useClaude && !aiAvailable()) {
    return NextResponse.json({ error: "DeepSeek is not configured. Add TASKS_API_KEY or DEEPSEEK_API_KEY." }, { status: 503 });
  }

  try {
    // Last 48h — both portfolio and market lane, highest signal first.
    const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const [newsRes, holdingsRes] = await Promise.all([
      supabase
        .from("news_articles")
        .select("title, url, source, published_at, ai_summary, sentiment, relevance_score, category, scope, impact_tickers, is_interesting, ticker, company_name")
        .eq("user_id", user.id)
        .eq("ignored", false)
        .eq("low_confidence", false)
        .gte("created_at", since)
        .order("is_interesting", { ascending: false })
        .order("relevance_score", { ascending: false })
        .limit(40),
      supabase
        .from("holdings")
        .select("ticker, company_name, sector, quantity, avg_cost")
        .eq("user_id", user.id)
        .gt("quantity", 0),
    ]);

    const articles = newsRes.data ?? [];
    const holdings = holdingsRes.data ?? [];

    if (articles.length === 0) {
      return NextResponse.json({ content: "No news in the last 48 hours. Refresh the news feed first then try again.", model: "none" });
    }

    const holdingsList = holdings.length
      ? holdings.map((h) => `${h.ticker} (${h.company_name ?? h.ticker}, ${h.sector ?? "sector ?"}, qty ${h.quantity})`).join(", ")
      : "No holdings imported.";

    const articleLines = articles.map((a, i) => {
      const parts = [
        `${i + 1}. [${a.scope === "market" ? "MARKET" : a.ticker ?? "?"}] ${a.title}`,
        `   ${a.source} | ${a.published_at?.slice(0, 10) ?? "?"} | ${a.category ?? "?"}${a.sentiment ? ` | ${a.sentiment}` : ""}`,
      ];
      if (a.ai_summary) parts.push(`   ${a.ai_summary}`);
      if (a.impact_tickers?.length) parts.push(`   touches: ${a.impact_tickers.join(", ")}`);
      return parts.join("\n");
    }).join("\n\n");

    const system = `You are a sharp, independent PSX (Pakistan Stock Exchange) market analyst writing a brief for a serious investor at the start of their day. Think freely and reason deeply about what the news actually means for this specific portfolio and for the broader market. Be direct and opinionated — back every claim with the figures and facts in the feed. PKR unless stated otherwise.`;

    const prompt = `My PSX portfolio: ${holdingsList}

News from the last 48 hours:
${articleLines}

---
Write a sharp analyst brief using markdown ## headers for these sections:

## Top Signal
The single most important development right now and exactly why it matters — with the numbers.

## Portfolio Impact
Go holding by holding where the news actually touches one of my positions: which holding, what changed, and how it shifts the picture. Be specific about the mechanism (does this news really affect this company's revenue/costs/demand, or only indirectly?). If a story doesn't genuinely touch a holding, don't force it.

## Market Read
Is the macro backdrop for PSX bullish, bearish, or mixed right now? The key drivers, with figures.

## Watch This Week
2-4 specific developments to monitor — only things evidenced by the news above.

## Interesting Finds
1-2 genuinely notable or surprising items worth knowing even if they don't directly hit my portfolio.`;

    let content: string;
    let usedModel: string;

    if (useClaude) {
      const def = getModelDef(model);
      const params = buildClaudeParams({ ...def, maxTokens: Math.max(def.maxTokens, 2600) });
      const msg = await getClaude().messages.create({
        ...params,
        system,
        messages: [{ role: "user", content: prompt }],
      });
      content = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      usedModel = def.apiModel;
    } else {
      const res = await taskText(system, prompt, 3500);
      content = res.content;
      usedModel = res.model;
    }

    // Persist so the brief survives reloads and shows up in Briefings history.
    const title = `News brief — ${new Date().toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}`;
    const { data: saved } = await supabase
      .from("ai_briefings")
      .insert({
        user_id: user.id,
        briefing_type: "news_brief",
        title,
        content,
        model: usedModel,
        meta: { articles: articles.length, holdings: holdings.length, picker: model },
      })
      .select("id, created_at")
      .single();

    return NextResponse.json({ content, model: usedModel, id: saved?.id ?? null, created_at: saved?.created_at ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
