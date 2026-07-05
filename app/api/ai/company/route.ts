import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { chatMarkdown, aiAvailable } from "@/lib/ai/openai";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { getCompanyFilings } from "@/lib/company/filings";
import { getCompanyDividends } from "@/lib/company/dividends";
import { getPortfolio } from "@/lib/portfolio";
import { formatNumber } from "@/lib/utils";
import { accountHasFeature } from "@/lib/features";
import { rejectDemoWrite } from "@/lib/demo-mode";

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
      "Summarize the latest earnings picture using the structured financials and computed ratios in context. Quote actual figures (revenue, profit, EPS, margins, growth) where available. If any key figure is missing, say so and point to the relevant filing.",
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
      "Using the computed ratios and structured financials in context, explain what the current valuation picture looks like for this company. For each ratio: the value, what it means, and whether it looks attractive or stretched given the sector. Where a ratio is missing, explain what input is needed.",
  },
  explain_technicals: {
    title: "Technical Picture",
    prompt:
      "Explain the technical picture using the moving averages, RSI, 52-week range, volume, and volatility provided. Be direct — if the setup looks bullish or bearish, say so.",
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
      "Write a structured research memo: (1) what the company is, (2) technical picture, (3) dividend picture, (4) recent official filings, (5) what data is missing to complete the analysis, (6) open questions. Be direct with your interpretation and views.",
  },
};

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  if (!(await accountHasFeature(supabase, user.id, "company_reports"))) {
    return NextResponse.json({ error: "Company AI analysis is disabled for this account." }, { status: 403 });
  }

  if (!aiAvailable()) {
    return NextResponse.json({ error: "AI provider is not configured. Add TASKS_API_KEY or DEEPSEEK_API_KEY in .env.local." }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { ticker: string; action: Action };
    const action = PROMPTS[body.action] ? body.action : "summarize_company";
    const ticker = (body.ticker ?? "").toUpperCase();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    const [metadata, technicals, filings, dividends, portfolio, financialsRes, ratiosRes] = await Promise.all([
      getCompanyMetadata(supabase, ticker),
      getTechnicals(supabase, ticker),
      getCompanyFilings(ticker, 12),
      getCompanyDividends(supabase, user.id, ticker),
      getPortfolio(supabase, user.id),
      supabase
        .from("company_financials")
        .select("period_type, fiscal_year, fiscal_period, statement_type, source_type, reporting_basis, data, confidence")
        .eq("ticker", ticker)
        .eq("review_status", "published")
        .order("fiscal_year", { ascending: false })
        .limit(12),
      supabase
        .from("company_ratios")
        .select("ratio_name, ratio_value, formula, inputs, missing, source_period")
        .eq("ticker", ticker),
    ]);

    const holding = portfolio.holdings.find((h) => h.ticker === ticker);
    const n = (v: number | null) => (v === null ? "n/a" : formatNumber(v));

    const fins = (financialsRes.data ?? []) as {
      period_type: string; fiscal_year: number | null; fiscal_period: string | null;
      statement_type: string; source_type: string | null; reporting_basis: string | null;
      data: Record<string, number | null | string>; confidence: number | null;
    }[];
    const ratios = (ratiosRes.data ?? []) as {
      ratio_name: string; ratio_value: number | null; formula: string;
      inputs: Record<string, number | string | null>; missing: string | null; source_period: string | null;
    }[];

    function finsBlock(): string {
      if (!fins.length) return "No financial statements extracted yet.";
      const lines: string[] = [];
      for (const row of fins) {
        const label = `${row.fiscal_year ?? "?"} ${row.fiscal_period ?? row.period_type} [${row.statement_type}] (${row.source_type ?? "?"}, ${row.reporting_basis ?? "unlabelled"}, confidence ${((row.confidence ?? 0) * 100).toFixed(0)}%)`;
        const entries = Object.entries(row.data)
          .filter(([k, v]) => !k.startsWith("_") && typeof v === "number")
          .map(([k, v]) => `  ${k}: ${formatNumber(v as number)}`)
          .join("\n");
        if (entries) lines.push(`${label}\n${entries}`);
      }
      return lines.join("\n\n") || "No numeric data in stored statements.";
    }

    function ratiosBlock(): string {
      if (!ratios.length) return "No ratios computed yet.";
      const computable = ratios.filter((r) => r.ratio_value !== null);
      const missing = ratios.filter((r) => r.ratio_value === null);
      const lines: string[] = [];
      if (computable.length) {
        lines.push("Computed ratios:");
        computable.forEach((r) => lines.push(`  ${r.ratio_name}: ${r.ratio_value?.toFixed(2)} (${r.source_period ?? "?"})`));
      }
      if (missing.length) {
        lines.push("Uncomputable (missing inputs):");
        missing.forEach((r) => lines.push(`  ${r.ratio_name}: ${r.missing}`));
      }
      return lines.join("\n");
    }

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
      `## Structured financials (units: PKR thousands unless noted)`,
      finsBlock(),
      ``,
      `## Computed ratios`,
      ratiosBlock(),
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
        "You are a PSX company research assistant. Use ONLY the provided context. Never fabricate financial figures. Be explicit about missing data. Give direct views including buy/sell/hold opinions when the data supports them.",
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
