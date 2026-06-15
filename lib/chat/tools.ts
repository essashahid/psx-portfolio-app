import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import {
  getQuoteCard, getPositionCard, getRatioCard, getTechnicalCard, getDividendCard,
  getNewsCard, getMarketCard, getHoldingsSummary,
} from "@/lib/chat/data";

/**
 * Tools Claude can call when the pre-fetched brief isn't enough (a second
 * ticker, a follow-up, a comparison). Each returns the same compact JSON the
 * cards use — Claude orchestrates which data to pull; it never ingests raw
 * documents. The UI separately renders cards from these same getters, so tool
 * calls add reasoning, not token-heavy formatting.
 */

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_ticker",
    description: "Resolve a company name or partial symbol to a PSX ticker. Use when the user names a company you don't have a ticker for.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Company name or symbol fragment" } }, required: ["query"] },
  },
  {
    name: "get_quote",
    description: "Latest price, day change, volume and market cap for a PSX ticker.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
  },
  {
    name: "get_position",
    description: "The user's holding in a ticker: quantity, average cost, market value, and unrealized profit/loss. Returns null if they don't own it.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
  },
  {
    name: "get_ratios",
    description: "Fundamental ratios (P/E, ROE, margins, dividend yield, growth, leverage) for a ticker, from the latest reported financials.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
  },
  {
    name: "get_technicals",
    description: "52-week range, RSI, and moving averages for a ticker.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
  },
  {
    name: "get_dividends",
    description: "Trailing-12-month cash dividend per share and recent payout history for a ticker.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
  },
  {
    name: "get_news",
    description: "Recent official PSX filings/announcements. Pass a ticker for one company, or omit for market-wide.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } } },
  },
  {
    name: "get_market_overview",
    description: "Today's PSX index level, breadth (advancers/decliners), and leading/lagging sectors.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_holdings",
    description: "The user's full list of holdings with today's change for each.",
    input_schema: { type: "object", properties: {} },
  },
];

/** Execute one tool call and return a compact JSON-able result. */
export async function executeTool(
  db: SupabaseClient,
  userId: string,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const ticker = typeof input.ticker === "string" ? input.ticker.toUpperCase() : null;
  switch (name) {
    case "search_ticker": {
      const q = String(input.query ?? "").trim();
      if (!q) return { matches: [] };
      const { data } = await db
        .from("stock_universe")
        .select("ticker, company_name, sector")
        .or(`ticker.ilike.%${q}%,company_name.ilike.%${q}%`)
        .limit(8);
      return { matches: data ?? [] };
    }
    case "get_quote":
      return ticker ? (await getQuoteCard(db, ticker)) ?? { error: "no quote" } : { error: "ticker required" };
    case "get_position":
      return ticker ? (await getPositionCard(db, userId, ticker)) ?? { owned: false } : { error: "ticker required" };
    case "get_ratios":
      return ticker ? (await getRatioCard(db, ticker)) ?? { error: "no ratios — financials not loaded" } : { error: "ticker required" };
    case "get_technicals":
      return ticker ? (await getTechnicalCard(db, ticker)) ?? { error: "no technicals" } : { error: "ticker required" };
    case "get_dividends":
      return ticker ? (await getDividendCard(db, ticker)) ?? { error: "no payouts on record" } : { error: "ticker required" };
    case "get_news":
      return (await getNewsCard(db, ticker, 6)) ?? { items: [] };
    case "get_market_overview":
      return (await getMarketCard(db)) ?? { error: "no snapshot yet" };
    case "list_holdings":
      return (await getHoldingsSummary(db, userId)) ?? { count: 0, holdings: [] };
    default:
      return { error: `unknown tool ${name}` };
  }
}
