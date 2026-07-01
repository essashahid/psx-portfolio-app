import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { aiAvailable } from "@/lib/ai/openai";
import { taskText } from "@/lib/ai/tasks";
import { getClaude, claudeConfigured, buildClaudeParams } from "@/lib/ai/claude";
import { getModelDef } from "@/lib/ai/models";
import { rejectDemoWrite } from "@/lib/demo-mode";
import { getUserNewsFeed } from "@/lib/news/global-store";

export const maxDuration = 120;

type BriefModel = "deepseek" | "claude-sonnet" | "claude-opus";

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

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
      getUserNewsFeed(supabase, user.id, 120),
      supabase
        .from("holdings")
        .select("ticker, company_name, sector, quantity, avg_cost")
        .eq("user_id", user.id)
        .gt("quantity", 0),
    ]);

    const sinceMs = new Date(since).getTime();
    const articles = newsRes
      .filter((a) => !a.ignored && !a.low_confidence && articleTime(a) >= sinceMs)
      .sort(
        (a, b) =>
          Number(b.is_interesting) - Number(a.is_interesting) ||
          (b.relevance_score ?? 0) - (a.relevance_score ?? 0) ||
          articleTime(b) - articleTime(a)
      )
      .slice(0, 40);
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

Stored events from the last 48 hours:
${articleLines}

---
Write a compact daily investor brief using markdown ## headers for exactly these sections:

## Top developments
The 2-4 most important factual developments. Use cautious language and cite the source name in prose.

## Portfolio relevance
Only mention holdings or sectors where the relationship is defensible. Distinguish direct company news from indirect sector or macro relevance.

## What to watch
2-4 concrete follow-ups such as official notifications, effective dates, company guidance, margins, rate commentary, or sector data.

## Upcoming events
Mention any upcoming or expected events evidenced by the feed. If none are evidenced, say none are confirmed in this feed.

## Uncertainties
List details that remain incomplete, single-source, or not company-specific.

Do not recommend buying or selling. Do not invent events, figures, or exposure.`;

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

function articleTime(article: { published_at: string | null; created_at: string }): number {
  const t = new Date(article.published_at ?? article.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}
