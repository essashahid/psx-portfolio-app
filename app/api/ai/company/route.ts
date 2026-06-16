import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { chatMarkdown, aiAvailable } from "@/lib/ai/openai";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { getCompanyFilings } from "@/lib/company/filings";
import { getCompanyDividends } from "@/lib/company/dividends";
import { getPortfolio } from "@/lib/portfolio";
import { formatNumber } from "@/lib/utils";

export const maxDuration = 120;

type Action =
  | "summarize_company"
  | "summarize_earnings"
  | "explain_trends"
  | "find_risks"
  | "explain_ratios"
  | "explain_technicals"
  | "compare_portfolio"
  | "research_questions"
  | "research_memo";

const PROMPTS: Record<Action, { title: string; prompt: string }> = {
  summarize_company: {
    title: "Company Summary",
    prompt:
      "Summarize what this company is and does using only the provided profile and sector. If the profile is missing, say so and describe only what can be inferred from the sector. Keep it factual; do not invent financial figures.",
  },
  summarize_earnings: {
    title: "Latest Earnings Summary",
    prompt:
      "Summarize the latest earnings picture. We do NOT have structured income-statement data in context, so be explicit that detailed earnings figures are unavailable, point to the most recent result/board-meeting filings listed, and explain what the user should open to read the actual numbers. Do not fabricate revenue, profit, or EPS.",
  },
  explain_trends: {
    title: "Key Trends",
    prompt:
      "Explain the key trends visible in the available data: price trend vs moving averages, distance from 52-week high/low, volume, and any dividend cadence. Separate fact from interpretation. Note that fundamental (revenue/profit) trends are not in context.",
  },
  find_risks: {
    title: "Risk Scan",
    prompt:
      "Identify risks that are grounded in the available data and filings: technical position (e.g. below long-term MA, near lows), volatility, lack of recent filings, and any dividend signals. For each, give a one-line 'what to watch'. Do not invent risks with no basis in the context.",
  },
  explain_ratios: {
    title: "Valuation & Ratios",
    prompt:
      "Explain which valuation/profitability ratios matter for a company in this sector and what each would tell the user. State clearly that the inputs (EPS, book value, net income) are NOT available in context, so no ratio can be computed here, and tell the user where to get them. Do not invent ratio values.",
  },
  explain_technicals: {
    title: "Technical Picture",
    prompt:
      "Explain the technical picture in neutral language using the moving averages, RSI, 52-week range, volume, and volatility provided. Use phrasing like 'price is above the 50-day MA' or 'RSI is elevated'. Never say buy or sell.",
  },
  compare_portfolio: {
    title: "Portfolio Comparison",
    prompt:
      "Compare this company against the user's existing portfolio exposure described in context: do they already own it, how would adding it change sector concentration, and what overlaps exist. Frame as observations, not recommendations.",
  },
  research_questions: {
    title: "Research Questions",
    prompt:
      "Generate 6-8 specific questions the user should research before forming a view on this company, grounded in its sector and the gaps in the available data (e.g. missing financials). Each question should be answerable from a filing or report.",
  },
  research_memo: {
    title: "Research Memo",
    prompt:
      "Write a structured research memo: (1) what the company is, (2) technical picture, (3) dividend picture, (4) recent official filings, (5) what data is missing to complete the analysis, (6) open questions. Clearly separate facts from interpretation. No buy/sell/hold language.",
  },
};

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!aiAvailable()) {
    return NextResponse.json({ error: "AI provider is not configured. Add TASKS_API_KEY or DEEPSEEK_API_KEY in .env.local." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { ticker: string; action: Action };
    const action = PROMPTS[body.action] ? body.action : "summarize_company";
    const ticker = (body.ticker ?? "").toUpperCase();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    const [metadata, technicals, filings, dividends, portfolio] = await Promise.all([
      getCompanyMetadata(supabase, ticker),
      getTechnicals(supabase, ticker),
      getCompanyFilings(ticker, 12),
      getCompanyDividends(supabase, user.id, ticker),
      getPortfolio(supabase, user.id),
    ]);

    const holding = portfolio.holdings.find((h) => h.ticker === ticker);
    const n = (v: number | null) => (v === null ? "n/a" : formatNumber(v));

    const context = [
      `# ${ticker} — ${metadata.companyName ?? "name unknown"} (${metadata.sector ?? "sector unknown"})`,
      `Exchange: PSX | Industry: ${metadata.industry ?? "unknown"}`,
      `Profile: ${metadata.description ?? "NO PROFILE ON FILE — flag this as missing."}`,
      ``,
      `## Technical snapshot (source: PSX, as of ${technicals.asOfDate ?? "n/a"})`,
      `Price: ${n(technicals.latestPrice)} | Day change: ${technicals.dayChangePct?.toFixed(2) ?? "n/a"}%`,
      `MA20/50/100/200: ${n(technicals.ma20)} / ${n(technicals.ma50)} / ${n(technicals.ma100)} / ${n(technicals.ma200)}`,
      `RSI: ${technicals.rsi?.toFixed(0) ?? "n/a"} | 52w high/low: ${n(technicals.fiftyTwoWeekHigh)} / ${n(technicals.fiftyTwoWeekLow)}`,
      `Distance from 52w high/low: ${technicals.distanceFromHighPct?.toFixed(1) ?? "n/a"}% / ${technicals.distanceFromLowPct?.toFixed(1) ?? "n/a"}%`,
      `Avg volume: ${n(technicals.averageVolume)} | Annualized volatility: ${technicals.volatility?.toFixed(1) ?? "n/a"}%`,
      `Flags: ${technicals.flags.map((f) => f.label).join("; ") || "none"}`,
      ``,
      `## Structured financials`,
      `NOT AVAILABLE in context — no income statement, balance sheet, cash flow, EPS, or book value. Do not invent these.`,
      ``,
      `## Dividend history (recorded)`,
      dividends.length
        ? dividends
            .slice(0, 10)
            .map((d) => `- ${d.announcementDate ?? d.date ?? "?"}: ${d.kind}, ${d.perShare ?? "?"}/share`)
            .join("\n")
        : "None recorded.",
      ``,
      `## Recent official PSX filings`,
      filings.length
        ? filings.map((f) => `- ${f.date ?? "?"} [${f.category}] ${f.title}`).join("\n")
        : "None retrieved.",
      ``,
      `## User's portfolio context`,
      holding
        ? `OWNS this stock: ${holding.quantity} shares @ avg ${holding.avg_cost.toFixed(2)}, weight ${holding.weight?.toFixed(1) ?? "?"}%, unrealized P/L ${holding.unrealized_pl?.toFixed(0) ?? "?"}.`
        : "User does NOT currently hold this stock.",
      `Portfolio sectors: ${portfolio.sectorWeights.map((s) => `${s.sector} ${s.weight.toFixed(0)}%`).join(", ") || "n/a"}`,
      `Largest holding: ${portfolio.largestHolding?.ticker ?? "n/a"} (${portfolio.largestHolding?.weight?.toFixed(0) ?? "?"}%)`,
      ``,
      `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    ].join("\n");

    const def = PROMPTS[action];
    const output = await logAgentRun(supabase, user.id, "company_analysis", { ticker, action }, async () => {
      const { content, model } = await chatMarkdown(
        "You are a PSX company research assistant. Use ONLY the provided context. Never fabricate financial figures. Be explicit about missing data. Never give buy/sell/hold advice.",
        `${def.prompt}\n\n--- CONTEXT ---\n${context}`,
        1800
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
          meta: { action, scope: "company" },
        })
        .select("id, title, content, created_at")
        .single();
      if (insErr) throw insErr;
      return { result: saved };
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
