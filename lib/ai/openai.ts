import { tasksConfigured, taskJson, taskText } from "@/lib/ai/tasks";

/** Master kill switch for analysis AI. Set AI_DISABLED=true to halt every tasks call. */
export function aiDisabled(): boolean {
  const v = (process.env.AI_DISABLED ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** DeepSeek tasks provider is configured and not disabled. */
export function aiConfigured(): boolean {
  return !aiDisabled() && tasksConfigured();
}

/** Alias for aiConfigured — kept for call-site compatibility. */
export function aiAvailable(): boolean {
  return aiConfigured();
}

/**
 * Guardrails applied to every AI call. The assistant is a research aid, never
 * an advisor: no buy/sell/hold recommendations, no certainty inflation, cite
 * sources, state missing data.
 */
export const GUARDRAILS = `You are the research assistant inside PortfolioOS PK, a private Pakistan Stock Exchange (PSX) portfolio tracker.

Rules:
- Do not overstate certainty. If something is unconfirmed or inferred, say so.
- When summarizing news, cite the source URL.
- If data you need is missing (prices, dates, thesis), explicitly say what is missing instead of guessing.
- Keep output clear, structured, and actionable.
- Amounts are in PKR unless stated otherwise.`;

export async function chatMarkdown(
  systemExtra: string,
  userPrompt: string,
  maxTokens = 1800,
): Promise<{ content: string; model: string }> {
  return taskText(`${GUARDRAILS}\n\n${systemExtra}`, userPrompt, maxTokens);
}

export async function chatJson<T>(
  systemExtra: string,
  userPrompt: string,
  maxTokens = 2500,
): Promise<{ data: T; model: string }> {
  return taskJson<T>(`${GUARDRAILS}\n\n${systemExtra}`, userPrompt, maxTokens);
}

// ---------------------------------------------------------------------------
// News analysis
// ---------------------------------------------------------------------------

export interface ArticleAnalysis {
  url: string;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  relevance_score: number;
  affected_tickers: string[];
  why_it_matters: string;
  possible_thesis_impact: string;
  suggested_user_review_question: string;
  category: "dividend" | "result" | "general";
}

export async function analyzeArticles(
  articles: { url: string; title: string; snippet: string; ticker: string; company_name: string }[],
  portfolioContext: string
): Promise<{ analyses: ArticleAnalysis[]; model: string }> {
  const { data, model } = await chatJson<{ articles: ArticleAnalysis[] }>(
    `You analyze news articles for relevance to the user's PSX holdings.
For each article return: url (echo exactly), summary (2-3 sentences), sentiment (positive|neutral|negative — from the holder's perspective), relevance_score (1-10, where 10 = directly about the company's financials/dividends/major events, 1 = barely related), affected_tickers (array), why_it_matters (1 sentence), possible_thesis_impact (1 sentence, or "No clear thesis impact"), suggested_user_review_question (a question the user should ask themselves), category ("dividend" if about dividend announcements, "result" if about financial results, else "general").
Return JSON: {"articles": [...]}.`,
    `User's holdings context:\n${portfolioContext}\n\nArticles to analyze:\n${JSON.stringify(articles, null, 1)}`
  );
  return { analyses: data.articles ?? [], model };
}
