import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import {
  getQuoteCard, getPositionCard, getRatioCard, getTechnicalCard, getDividendCard,
  getNewsCard, getMarketCard, getHoldingsSummary, getSectorCard, getDailyCandles,
  getPositionHistoryCard,
} from "@/lib/chat/data";
import { getForeignFlowCard } from "@/lib/market/foreign-flows";
import { getPortfolio } from "@/lib/portfolio";
import { tavilySearch, tavilyConfigured } from "@/lib/tavily";
import { emaSeries, smaSeries, rsiSeries, toWeekly, type Candle } from "@/lib/market/technicals";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";

type IndicatorKind = "ema" | "sma" | "rsi";

/**
 * Compute an arbitrary-period indicator from a daily close series, on the daily
 * or weekly timeframe. Returns the latest value plus the last few values with
 * their dates, so the model can answer precise indicator questions (a 5-day
 * EMA, a 9-day RSI) it isn't handed in the standard technicals bundle.
 */
function computeIndicator(
  ticker: string,
  candles: Candle[],
  indicator: IndicatorKind,
  period: number,
  timeframe: "daily" | "weekly"
): Record<string, unknown> {
  let series = candles
    .filter((c) => Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (timeframe === "weekly") series = toWeekly(series);
  const closes = series.map((c) => c.close);

  const valSeries =
    indicator === "ema" ? emaSeries(closes, period)
    : indicator === "sma" ? smaSeries(closes, period)
    : rsiSeries(closes, period);

  const dated = series
    .map((c, i) => ({ date: c.date, value: valSeries[i] }))
    .filter((x): x is { date: string; value: number } => x.value != null);

  if (dated.length === 0) {
    return {
      ticker, indicator: indicator.toUpperCase(), period, timeframe,
      value: null,
      note: `Not enough ${timeframe} history to compute a ${period}-period ${indicator.toUpperCase()} (have ${closes.length} ${timeframe} closes).`,
    };
  }

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const last = dated[dated.length - 1];
  const shortDailyAvg = timeframe === "daily" && indicator !== "rsi" && period <= 20;
  return {
    ticker,
    indicator: indicator.toUpperCase(),
    period,
    timeframe,
    asOf: last.date,
    value: round3(last.value),
    recent: dated.slice(-6).map((d) => ({ date: d.date, value: round3(d.value) })),
    closesUsed: closes.length,
    ...(shortDailyAvg
      ? { note: "Short-term daily average. The platform is built for long-term investing, so treat this as information, not a trade signal." }
      : {}),
  };
}

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
    name: "get_position_history",
    description: "Transaction-level evidence for an existing-holding decision: verified buy/sell/corporate-action rows, cost-basis evolution, quantity reconciliation across holdings, transaction ledger and broker checkpoint, current cash/portfolio weights, and add-size scenarios. Use before answering whether to add, average up/down, trim, or size an existing position.",
    input_schema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        proposed_amount: { type: "number", description: "Optional PKR amount the user is considering adding. If omitted, the tool builds sensible scenarios from recent buy size, cash, position size and portfolio value." },
      },
      required: ["ticker"],
    },
  },
  {
    name: "get_ratios",
    description: "Fundamental ratios (P/E, ROE, margins, dividend yield, growth, leverage) for a ticker, from the latest reported financials.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
  },
  {
    name: "get_technicals",
    description: "Long-term structure read for a ticker, written for investors rather than traders. It returns the 52-week range, RSI, and moving averages, plus the multi-year trend (weekly EMA21/55), momentum-divergence trend warnings, a healthy accumulation range (where to gradually accumulate a quality company, with no stop-loss, no price target, and no risk/reward), and multi-year seasonality for timing capital deployment. Use it to judge whether the price is an attractive long-term accumulation level, extended, or deteriorating. It is always secondary to fundamentals. Do not turn this into a swing-trade setup.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
  },
  {
    name: "compute_indicator",
    description: "Compute a precise technical indicator from the ticker's own daily close history for any period the standard technicals bundle doesn't already give you — e.g. a 5-day EMA, a 10-day SMA, or a 9-day RSI. Supports EMA, SMA and RSI on the daily or weekly timeframe. Returns the latest value plus the last few values with their dates. Use this whenever the user asks for a specific indicator value rather than guessing or saying it's unavailable. The long-term-investor framing still holds: report the number, but do not build a short-term trade signal around it.",
    input_schema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        indicator: { type: "string", enum: ["ema", "sma", "rsi"], description: "ema, sma, or rsi" },
        period: { type: "number", description: "Lookback period in bars, e.g. 5 for a 5-day EMA. 1-400." },
        timeframe: { type: "string", enum: ["daily", "weekly"], description: "Bar timeframe. Default daily." },
      },
      required: ["ticker", "indicator", "period"],
    },
  },
  {
    name: "get_dividends",
    description:
      "Trailing-12-month cash dividend per share and recent payout history. Pass tickers (an array, up to 20) to fetch several holdings in ONE call, always batch instead of calling once per ticker; ticker (single) also works.",
    input_schema: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "One symbol. Prefer tickers for more than one." },
        tickers: { type: "array", items: { type: "string" }, description: "Several symbols fetched in one call, e.g. every payer in the portfolio." },
      },
    },
  },
  {
    name: "get_news",
    description: "The user's News Center feed: macro/market/policy/commodity stories, holding-specific news (with AI summary and sentiment), and official PSX filings. Pass a ticker for news about that company (including market stories flagged as impacting it), or omit for the latest portfolio + market news.",
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
    description: "The user's full list of holdings with, for each, its sector, portfolio weight (% of value), market value and today's change — plus a value-weighted sector concentration breakdown. Use for concentration, diversification, or 'what am I lacking' questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_portfolio_summary",
    description: "The user's whole-portfolio snapshot: total market value and cost, unrealized and realized P/L, dividend income (received, expected, pending), cash balance, holdings count, largest holding, largest sector and full sector weights. Use for 'how am I doing', overall exposure/concentration, gains/losses or income questions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_thesis",
    description: "The user's own saved investment thesis for a holding: why they bought, their expectation, time horizon, key risks, sell/add conditions, conviction (1-5), status (Active/Watch/Weakening/Broken/Closed) and review date. Pass a ticker for one, or omit for all theses. Use whenever a question touches WHY they own something, whether news/results change their view, conviction, or review timing — ground the answer in their actual reasoning.",
    input_schema: { type: "object", properties: { ticker: { type: "string" } } },
  },
  {
    name: "get_journal",
    description: "The user's own journal entries — decisions and notes they wrote (buy/sell decisions, hold reviews, news reactions, result reviews, lessons learned). Pass a ticker to filter, or omit for the most recent across the portfolio. Use to ground answers in what the user previously decided or observed.",
    input_schema: { type: "object", properties: { ticker: { type: "string" }, limit: { type: "number", description: "Max entries, default 8" } } },
  },
  {
    name: "get_performance",
    description: "The user's portfolio total value and unrealized P/L over time, from daily snapshots. Use for 'how has my portfolio done this week/month', trend, or drawdown questions.",
    input_schema: { type: "object", properties: { days: { type: "number", description: "Lookback window in days, default 30" } } },
  },
  {
    name: "get_foreign_flows",
    description: "Latest available foreign (FIPI) and local (LIPI) investor flows on PSX — the 'smart money' signal of whether foreigners are net buyers or sellers, and of which sectors. Defaults to current/latest non-stale data. Pass days for recent history, and include_stale_history only when the user explicitly asks for older stored data.",
    input_schema: {
      type: "object",
      properties: {
        sector: { type: "string", description: "Optional sector or bucket keyword, e.g. banks, cement, energy" },
        days: { type: "number", description: "Recent series window, 1-365 days. Default 10." },
        include_stale_history: { type: "boolean", description: "Only true when the user explicitly asks for older stored flow history." },
      },
    },
  },
  {
    name: "web_search",
    description: "Search the web for recent news / context NOT in the internal PSX data — e.g. WHY a stock or sector moved, macro events (IMF, policy rate, inflation, PKR), management/industry news. Returns recent articles with URLs. Prefer credible Pakistani business sources, and always cite the URLs you use. Use only when internal tools can't answer.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Search query — include the company/sector and 'Pakistan' for relevance" }, days: { type: "number", description: "How many days back to search (default 14)" } }, required: ["query"] },
  },
  {
    name: "list_company_reports",
    description: "List saved equity-research company reports for a ticker or across the portfolio.",
    input_schema: { type: "object", properties: { ticker: { type: "string", description: "Optional PSX ticker filter" } } },
  },
  {
    name: "get_company_report",
    description: "Fetch a saved company research report summary (executive summary, version, link).",
    input_schema: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        report_id: { type: "string", description: "Specific saved report id" },
      },
    },
  },
];

/**
 * Anthropic's native, server-side web search. Claude runs the search on
 * Anthropic's own infrastructure and returns cited results inline — no Tavily,
 * no API key of ours, no client-side execution. It replaces the Tavily-backed
 * custom `web_search` tool (same tool name) for Claude models only; DeepSeek
 * keeps the custom tool in CHAT_TOOLS since it has no equivalent server tool.
 *
 * We use the basic `web_search_20250305` version: supported on every Claude
 * model we offer (Haiku, Sonnet, Opus) with no extra dependency. The
 * dynamic-filtering versions (web_search_20260209+) require the code-execution
 * tool to be enabled and are limited to Opus 4.6+/Sonnet 4.6 — not worth the
 * complexity for lightweight PSX catalyst/news lookups.
 *
 * Note: the org admin must enable web search in the Claude Console for this to
 * work; billed by Anthropic at ~$10 per 1,000 searches.
 */
const NATIVE_WEB_SEARCH: Anthropic.WebSearchTool20250305 = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
};

/**
 * Tool set sent to Claude: the deterministic data tools, but with the
 * Tavily-backed custom `web_search` swapped for Anthropic's server-side one.
 */
export const CLAUDE_TOOLS: Anthropic.ToolUnion[] = [
  ...CHAT_TOOLS.filter((t) => t.name !== "web_search"),
  NATIVE_WEB_SEARCH,
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
    case "get_position_history":
      return ticker
        ? await getPositionHistoryCard(
            db,
            userId,
            ticker,
            typeof input.proposed_amount === "number" ? input.proposed_amount : null
          )
        : { error: "ticker required" };
    case "get_ratios":
      return ticker ? (await getRatioCard(db, ticker)) ?? { error: "no ratios — financials not loaded" } : { error: "ticker required" };
    case "get_technicals":
      return ticker ? (await getTechnicalCard(db, ticker)) ?? { error: "no technicals" } : { error: "ticker required" };
    case "compute_indicator": {
      if (!ticker) return { error: "ticker required" };
      const indicator = String(input.indicator ?? "").toLowerCase();
      if (indicator !== "ema" && indicator !== "sma" && indicator !== "rsi") {
        return { error: "indicator must be one of ema, sma, rsi" };
      }
      const period = Math.round(Number(input.period));
      if (!Number.isFinite(period) || period < 1 || period > 400) {
        return { error: "period must be a number between 1 and 400" };
      }
      const timeframe = input.timeframe === "weekly" ? "weekly" : "daily";
      // Cached daily history first; fall back to a live PSX fetch so the tool
      // works even for a ticker the user has never opened.
      let candles = await getDailyCandles(db, ticker);
      if (candles.length === 0) candles = (await fetchPsxEod(ticker)) as Candle[];
      if (candles.length === 0) return { error: `no price history available for ${ticker}` };
      return computeIndicator(ticker, candles, indicator, period, timeframe);
    }
    case "get_dividends": {
      // Batch mode: one call for many holdings, so an income question does not
      // cost 16 sequential round-trips (observed in a V4 Pro test run).
      const many = Array.isArray(input.tickers)
        ? [...new Set(input.tickers.filter((t): t is string => typeof t === "string").map((t) => t.toUpperCase()))].slice(0, 20)
        : [];
      if (many.length > 0) {
        const results = await Promise.all(many.map(async (t) => [t, (await getDividendCard(db, t)) ?? { error: "no payouts on record" }] as const));
        return Object.fromEntries(results);
      }
      return ticker ? (await getDividendCard(db, ticker)) ?? { error: "no payouts on record" } : { error: "ticker or tickers required" };
    }
    case "get_news":
      return (await getNewsCard(db, userId, ticker, 6)) ?? { items: [] };
    case "get_market_overview":
      return (await getMarketCard(db)) ?? { error: "no snapshot yet" };
    case "get_sector_performance":
      return (await getSectorCard(db, typeof input.sector === "string" ? input.sector : null)) ?? { error: "no sector data" };
    case "list_holdings":
      return (await getHoldingsSummary(db, userId)) ?? { count: 0, holdings: [] };
    case "get_portfolio_summary": {
      const p = await getPortfolio(db, userId);
      return {
        totalValue: p.totalValue,
        totalCost: p.totalCost,
        unrealizedPL: p.unrealizedPl,
        unrealizedPLPct: p.unrealizedPlPct,
        realizedPL: p.realizedPl,
        dividendIncome: p.dividendIncome,
        expectedDividendIncome: p.expectedDividendIncome,
        pendingDividendIncome: p.pendingDividendIncome,
        cashBalance: p.cashBalance,
        holdingsCount: p.holdingsCount,
        pricedHoldings: p.pricedHoldings,
        largestHolding: p.largestHolding,
        largestSector: p.largestSector,
        sectorWeights: p.sectorWeights,
      };
    }
    case "get_thesis": {
      let q = db
        .from("theses")
        .select("ticker, why_bought, expectation, time_horizon, key_risks, sell_conditions, add_conditions, confidence, status, review_date, updated_at")
        .eq("user_id", userId);
      if (ticker) q = q.eq("ticker", ticker);
      const { data } = await q.order("updated_at", { ascending: false }).limit(ticker ? 1 : 25);
      return data && data.length
        ? { theses: data }
        : { theses: [], note: ticker ? `No saved thesis for ${ticker}.` : "No theses saved yet." };
    }
    case "get_journal": {
      const limit = typeof input.limit === "number" ? Math.min(20, Math.max(1, Math.round(input.limit))) : 8;
      let q = db
        .from("journal_entries")
        .select("ticker, entry_date, entry_type, title, body, expected_outcome, risk, confidence, outcome, lessons")
        .eq("user_id", userId);
      if (ticker) q = q.eq("ticker", ticker);
      const { data } = await q.order("entry_date", { ascending: false }).limit(limit);
      const entries = (data ?? []).map((e) => ({ ...e, body: typeof e.body === "string" ? e.body.slice(0, 500) : e.body }));
      return entries.length
        ? { entries }
        : { entries: [], note: ticker ? `No journal entries for ${ticker}.` : "No journal entries yet." };
    }
    case "get_performance": {
      const days = typeof input.days === "number" && input.days > 0 ? Math.min(365, Math.round(input.days)) : 30;
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const { data } = await db
        .from("portfolio_snapshots")
        .select("snapshot_date, total_value, unrealized_pl")
        .eq("user_id", userId)
        .gte("snapshot_date", since)
        .order("snapshot_date", { ascending: true });
      if (!data || data.length === 0) return { snapshots: [], note: "No portfolio snapshots recorded yet." };
      const first = data[0];
      const last = data[data.length - 1];
      return {
        from: first.snapshot_date,
        to: last.snapshot_date,
        startValue: Number(first.total_value),
        endValue: Number(last.total_value),
        changeValue: Number(last.total_value) - Number(first.total_value),
        points: data.length,
        snapshots: data,
      };
    }
    case "get_foreign_flows":
      return (await getForeignFlowCard(db, typeof input.sector === "string" ? input.sector : null, {
        days: typeof input.days === "number" ? input.days : undefined,
        allowStale: input.include_stale_history === true,
      })) ?? { error: "no current foreign-flow data on record", note: "Older rows may exist, but default reads hide stale data unless include_stale_history is true." };
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
    case "list_company_reports": {
      let q = db.from("ai_briefings")
        .select("id, ticker, title, created_at, meta")
        .eq("user_id", userId)
        .eq("briefing_type", "company_report")
        .order("created_at", { ascending: false })
        .limit(10);
      if (typeof input.ticker === "string" && input.ticker.trim()) {
        q = q.eq("ticker", input.ticker.toUpperCase().trim());
      }
      const { data } = await q;
      return {
        reports: (data ?? []).map((r) => ({
          id: r.id,
          ticker: r.ticker,
          title: r.title,
          version: (r.meta as { reportVersion?: number })?.reportVersion ?? 1,
          createdAt: r.created_at,
        })),
      };
    }
    case "get_company_report": {
      const reportId = typeof input.report_id === "string" ? input.report_id : null;
      const ticker = typeof input.ticker === "string" ? input.ticker.toUpperCase().trim() : null;
      let row;
      if (reportId) {
        const { data } = await db.from("ai_briefings").select("id, ticker, title, meta, created_at").eq("id", reportId).eq("user_id", userId).maybeSingle();
        row = data;
      } else if (ticker) {
        const { data } = await db
          .from("ai_briefings")
          .select("id, ticker, title, meta, created_at")
          .eq("user_id", userId)
          .eq("ticker", ticker)
          .eq("briefing_type", "company_report")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        row = data;
      } else {
        return { error: "ticker or report_id required" };
      }
      if (!row) return { error: "no report found" };
      const payload = (row.meta as { reportPayload?: Record<string, unknown> })?.reportPayload;
      const company = payload?.evidence as { company?: { companyName?: string; sector?: string } } | undefined;
      return {
        id: row.id,
        ticker: row.ticker,
        title: row.title,
        version: (row.meta as { reportVersion?: number })?.reportVersion ?? 1,
        createdAt: row.created_at,
        companyName: company?.company?.companyName,
        sector: company?.company?.sector,
        executiveSummary: (payload as { narrative?: { executiveSummary?: unknown[] } })?.narrative?.executiveSummary?.slice(0, 4),
        link: `/research?id=${row.id}`,
      };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
