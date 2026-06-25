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
): Promise<{ content: string; model: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
  return taskText(`${GUARDRAILS}\n\n${systemExtra}`, userPrompt, maxTokens);
}

export async function chatJson<T>(
  systemExtra: string,
  userPrompt: string,
  maxTokens = 2500,
): Promise<{ data: T; model: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
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

// ---------------------------------------------------------------------------
// Market / macro news analysis
// ---------------------------------------------------------------------------

export interface MarketArticleAnalysis {
  url: string;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  market_relevance: number;
  category: "policy" | "economy" | "commodity" | "market" | "international" | "company" | "earnings" | "general";
  affected_tickers: string[];
  why_it_matters: string;
  is_interesting: boolean;
}

/**
 * Classifies macro / market / sector / international stories for a PSX
 * investor. Unlike analyzeArticles these are NOT tied to one holding — the
 * model decides the topic, how much it matters to the broader market, which
 * holdings (if any) it plausibly touches, and whether it's genuinely notable.
 */
export async function analyzeMarketArticles(
  articles: { url: string; title: string; snippet: string; source: string }[],
  portfolioContext: string
): Promise<{ analyses: MarketArticleAnalysis[]; model: string }> {
  const { data, model } = await chatJson<{ articles: MarketArticleAnalysis[] }>(
    `You triage market, macro, policy, commodity and international news for a Pakistan Stock Exchange (PSX) investor.
For each article return:
- url (echo exactly)
- summary (1-2 plain sentences, what actually happened — no fluff)
- sentiment (positive|neutral|negative for PSX equities broadly)
- market_relevance (1-10: 10 = clearly moves the KSE-100 / a major sector / the investor's holdings; 5 = relevant macro context; 1 = noise or irrelevant to PSX investing)
- category (policy | economy | commodity | market | international | company | earnings | general)
- affected_tickers (array of the user's holding tickers this story plausibly impacts; [] if none)
- why_it_matters (1 sentence: why a PSX investor should care)
- is_interesting (true only for genuinely notable, surprising or thesis-relevant stories — plant openings, big policy shifts, M&A, sharp commodity moves; false for routine/boilerplate)
Be strict: filings about director changes, treasury shares, attendance and other boilerplate get low market_relevance.
Return JSON: {"articles": [...]}.`,
    `User's holdings (for affected_tickers):\n${portfolioContext}\n\nArticles to triage:\n${JSON.stringify(articles, null, 1)}`
  );
  return { analyses: data.articles ?? [], model };
}
