import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { chatMarkdown, aiAvailable } from "@/lib/ai/openai";

export const maxDuration = 60;

export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!aiAvailable()) {
    return NextResponse.json({ error: "AI provider not configured." }, { status: 503 });
  }

  try {
    // Pull the last 48h of news — both portfolio and market lane, highest signal first.
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
        .select("ticker, company_name, sector, quantity, current_price, average_cost")
        .eq("user_id", user.id)
        .gt("quantity", 0),
    ]);

    const articles = newsRes.data ?? [];
    const holdings = holdingsRes.data ?? [];

    if (articles.length === 0) {
      return NextResponse.json({
        content: "No news in the last 48 hours. Refresh the news feed first then try again.",
        model: "none",
      });
    }

    const holdingsList = holdings
      .map((h) => `${h.ticker} (${h.company_name ?? h.ticker}, ${h.sector ?? "?"})`)
      .join(", ");

    const articleLines = articles.map((a, i) => {
      const parts = [
        `${i + 1}. [${a.scope === "market" ? "MARKET" : a.ticker ?? "?"}] ${a.title}`,
        `   Source: ${a.source} | ${a.published_at?.slice(0, 10) ?? "?"} | Sentiment: ${a.sentiment ?? "?"} | Category: ${a.category ?? "?"}`,
      ];
      if (a.ai_summary) parts.push(`   Summary: ${a.ai_summary}`);
      if (a.impact_tickers?.length) parts.push(`   Touches: ${a.impact_tickers.join(", ")}`);
      if (a.is_interesting) parts.push(`   ★ Flagged as notable`);
      return parts.join("\n");
    }).join("\n\n");

    const { content, model } = await chatMarkdown(
      `You are a sharp, direct PSX market analyst briefing an investor at the start of their day.

Rules:
- Be specific and opinionated — say what actually matters, not what "could" matter
- Use the investor's actual holdings to connect macro news to real positions
- Short sentences. No fluff. No "it is important to note that…"
- Highlight when something is genuinely surprising or unusual
- PKR amounts unless stated otherwise
- Do not give buy/sell/hold advice`,
      `My PSX portfolio: ${holdingsList || "No holdings yet"}

News from the last 48 hours:
${articleLines}

---
Give me a sharp analyst brief with these exact sections. Use markdown headers (##):

## Top Signal
The single most important piece of news right now and exactly why it matters.

## Portfolio Impact
For each piece of news that directly affects one of my holdings, say which holding, what changed, and how it shifts the picture. If nothing directly affects my holdings, say so plainly.

## Market Read
Based on the overall news flow — is the macro environment for PSX bullish, bearish, or mixed right now? 2-3 sentences with the key drivers.

## Watch This Week
2-3 specific things developing that I should monitor. No generic advice — only things evidenced by the news above.

## Interesting Finds
1-2 items from the feed that are genuinely notable, surprising, or worth knowing even if they don't directly affect my portfolio right now.`,
      1400
    );

    return NextResponse.json({ content, model });
  } catch (err) {
    return errorResponse(err);
  }
}
