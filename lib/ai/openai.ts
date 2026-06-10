import { GoogleGenerativeAI } from "@google/generative-ai";

export function aiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export function getModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.5-pro";
}

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured. Add it in .env.local to enable AI features.");
  }
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

/**
 * Guardrails applied to every AI call. The assistant is a research aid, never
 * an advisor: no buy/sell/hold recommendations, no certainty inflation, cite
 * sources, state missing data.
 */
export const GUARDRAILS = `You are the research assistant inside PortfolioOS PK, a private Pakistan Stock Exchange (PSX) portfolio tracker.

Hard rules — never break these:
- You are NOT a financial advisor. Never recommend buying, selling, or holding. Never use the words "buy", "sell", or "hold" as a recommendation or imperative.
- Use careful language instead: "consider reviewing", "this may affect your thesis", "this requires attention", "worth monitoring".
- Do not overstate certainty. If something is unconfirmed or inferred, say so.
- When summarizing news, cite the source URL.
- If data you need is missing (prices, dates, thesis), explicitly say what is missing instead of guessing.
- Keep output clear, structured, and actionable for a single retail investor reviewing their own portfolio.
- Amounts are in PKR unless stated otherwise.
- End every briefing-style output with the line: "_This is portfolio research support, not financial advice._"`;

export async function chatMarkdown(
  systemExtra: string,
  userPrompt: string,
  maxTokens = 1800
): Promise<{ content: string; model: string }> {
  const genAI = getClient();
  const modelId = getModel();
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: `${GUARDRAILS}\n\n${systemExtra}`,
    generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens },
  });
  const result = await model.generateContent(userPrompt);
  const content = result.response.text().trim();
  if (!content) throw new Error("AI returned an empty response.");
  return { content, model: modelId };
}

export async function chatJson<T>(
  systemExtra: string,
  userPrompt: string,
  maxTokens = 2500
): Promise<{ data: T; model: string }> {
  const genAI = getClient();
  const modelId = getModel();
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: `${GUARDRAILS}\n\n${systemExtra}\n\nRespond with valid JSON only.`,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  });
  const result = await model.generateContent(userPrompt);
  const content = result.response.text().trim();
  if (!content) throw new Error("AI returned an empty response.");
  return { data: JSON.parse(content) as T, model: modelId };
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
