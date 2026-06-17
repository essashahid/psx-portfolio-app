import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import {
  getQuoteCard, getPositionCard, getRatioCard, getTechnicalCard, getDividendCard,
  getNewsCard, getMarketCard, getHoldingsSummary, getSectorCard,
} from "@/lib/chat/data";
import { getForeignFlowCard } from "@/lib/market/foreign-flows";
import { tavilySearch, tavilyConfigured } from "@/lib/tavily";

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
    name: "get_sector_performance",
    description: "How a sector performed today — average return, advancers/decliners, top gainer/loser, volume. Pass a sector name like 'Cement', 'Commercial Banks', 'Fertilizer' (fuzzy-matched); omit to get all sectors ranked by return.",
    input_schema: { type: "object", properties: { sector: { type: "string", description: "Sector name or keyword, e.g. cement, banks, fertilizer" } } },
  },
  {
    name: "list_holdings",
    description: "The user's full list of holdings with today's change for each.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_foreign_flows",
    description: "Foreign (FIPI) and local (LIPI) investor flows on PSX — the 'smart money' signal of whether foreigners are net buyers or sellers, and of which sectors. Pass a sector/bucket keyword (e.g. 'banks', 'cement', 'energy') for one sector, or omit for the market-wide read with the by-sector and local-participant breakdown. Amounts are net USD millions; positive = net foreign buying.",
    input_schema: { type: "object", properties: { sector: { type: "string", description: "Optional sector or bucket keyword, e.g. banks, cement, energy" } } },
  },
  {
    name: "web_search",
    description: "Search the web for recent news / context NOT in the internal PSX data — e.g. WHY a stock or sector moved, macro events (IMF, policy rate, inflation, PKR), management/industry news. Returns recent articles with URLs. Prefer credible Pakistani business sources, and always cite the URLs you use. Use only when internal tools can't answer.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Search query — include the company/sector and 'Pakistan' for relevance" }, days: { type: "number", description: "How many days back to search (default 14)" } }, required: ["query"] },
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
    case "get_sector_performance":
      return (await getSectorCard(db, typeof input.sector === "string" ? input.sector : null)) ?? { error: "no sector data" };
    case "list_holdings":
      return (await getHoldingsSummary(db, userId)) ?? { count: 0, holdings: [] };
    case "get_foreign_flows":
      return (await getForeignFlowCard(db, typeof input.sector === "string" ? input.sector : null)) ?? { error: "no foreign-flow data on record" };
    case "web_search": {
      if (!tavilyConfigured()) return { error: "web search not configured" };
      const query = String(input.query ?? "").trim();
      if (!query) return { error: "query required" };
      const days = typeof input.days === "number" && input.days > 0 ? Math.min(60, input.days) : 14;
      try {
        const q = /pakistan|psx|kse/i.test(query) ? query : `${query} Pakistan PSX`;
        const results = await tavilySearch(q, { days, maxResults: 5 });
        return {
          results: results.map((r) => ({ title: r.title, url: r.url, date: r.published_date ?? null, snippet: (r.content ?? "").slice(0, 320) })),
        };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "search failed" };
      }
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
