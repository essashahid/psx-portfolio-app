import type { SupabaseClient } from "@supabase/supabase-js";
import { tavilySearch, holdingQueries, tavilyConfigured } from "@/lib/tavily";
import { analyzeArticles, aiAvailable } from "@/lib/ai/openai";
import { gdeltConfigured, gdeltSearchHoldings } from "@/lib/news/gdelt";
import { matchesHoldingText } from "@/lib/news/matching";
import { psxAnnouncementsConfigured, psxAnnouncementSearchHoldings } from "@/lib/news/psx-announcements";
import { fetchMarketNews, marketNewsConfigured } from "@/lib/news/feeds";
import type { DiscoveredNewsArticle, NewsSourceQuality } from "@/lib/news/types";

const MAX_HOLDINGS = 12;

export interface NewsRefreshResult {
  inserted: number;
  market: number;
  holding: number;
  errors: string[];
}

/**
 * Core news refresh logic — shared by the API route (user-triggered) and the
 * daily cron (automated). Pass an optional `ticker` to scope the holding lane
 * to one position (market lane is skipped in that case).
 */
export async function refreshNewsForUser(
  supabase: SupabaseClient,
  userId: string,
  opts: { ticker?: string } = {}
): Promise<NewsRefreshResult> {
  const tavilyEnabled = tavilyConfigured() && process.env.NEWS_ENABLE_TAVILY !== "false";
  const psxEnabled = psxAnnouncementsConfigured();
  const gdeltEnabled = gdeltConfigured();

  let holdingsQuery = supabase
    .from("holdings")
    .select("ticker, company_name, sector")
    .eq("user_id", userId)
    .gt("quantity", 0)
    .order("ticker")
    .limit(MAX_HOLDINGS);
  if (opts.ticker) holdingsQuery = holdingsQuery.eq("ticker", opts.ticker);
  const { data: holdingsData } = await holdingsQuery;
  const holdings = holdingsData ?? [];

  const { data: existing } = await supabase.from("news_articles").select("url").eq("user_id", userId);
  const known = new Set((existing ?? []).map((e) => e.url));

  const found: DiscoveredNewsArticle[] = [];
  const marketFound: DiscoveredNewsArticle[] = [];
  const errors: string[] = [];
  let skippedNoMatch = 0;

  function addHolding(article: DiscoveredNewsArticle) {
    if (known.has(article.url)) return;
    known.add(article.url);
    found.push(article);
  }

  if (psxEnabled) {
    const { articles, errors: e } = await psxAnnouncementSearchHoldings(holdings, { maxResultsPerHolding: 4 });
    for (const a of articles) addHolding(a);
    errors.push(...e);
  }

  if (tavilyEnabled) {
    for (const h of holdings) {
      for (const q of holdingQueries(h)) {
        try {
          const results = await tavilySearch(q, { days: 7, maxResults: 4 });
          for (const r of results) {
            if (!matchesHoldingText(h, [r.title, r.content ?? "", r.url])) { skippedNoMatch++; continue; }
            addHolding({
              url: r.url,
              title: r.title,
              snippet: (r.content ?? "").slice(0, 1500),
              ticker: h.ticker,
              company_name: h.company_name ?? h.ticker,
              sector: h.sector,
              source: safeHostname(r.url),
              published_at: r.published_date ?? null,
              provider: "tavily",
              scope: "portfolio",
              category: "general",
              source_quality: sourceQuality(safeHostname(r.url)),
              link_reason: `Matched ${h.ticker} by company name: ${h.company_name}.`,
            });
          }
        } catch (e) {
          errors.push(`${h.ticker} Tavily: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  if (gdeltEnabled) {
    const { articles, errors: e } = await gdeltSearchHoldings(holdings, { days: 7, maxResultsPerHolding: 2 });
    for (const a of articles) addHolding(a);
    errors.push(...e);
  }

  // Market lane runs on every refresh — including ticker-scoped refreshes and
  // empty portfolios. Coverage is holding-independent, so it no longer depends
  // on the 12-holding cap or on whose portfolio triggered the run.
  if (marketNewsConfigured()) {
    const { articles, errors: e } = await fetchMarketNews(holdings, { maxArticles: 120 });
    for (const a of articles) {
      if (known.has(a.url)) continue;
      known.add(a.url);
      marketFound.push(a);
    }
    errors.push(...e);
  }

  // AI analysis — only for holding-specific articles (PSX announcements already
  // have metadata; market-lane articles are stored as-is and synthesised
  // on-demand by the Analyst Brief button, keeping cron token cost near zero).
  const portfolioContext = holdings
    .map((h) => `${h.ticker} = ${h.company_name} (${h.sector ?? "sector unknown"})`)
    .join("\n");
  const analysisByUrl = new Map<string, ReturnType<typeof Object.assign>>();

  if (aiAvailable()) {
    const aiCandidates = found.filter((a) => a.provider !== "psx-announcements");
    for (let i = 0; i < aiCandidates.length; i += 8) {
      try {
        const { analyses } = await analyzeArticles(
          aiCandidates.slice(i, i + 8).map((a) => ({
            url: a.url, title: a.title, snippet: a.snippet,
            ticker: a.ticker ?? "", company_name: a.company_name ?? "",
          })),
          portfolioContext
        );
        for (const a of analyses) analysisByUrl.set(a.url, a);
      } catch (e) {
        errors.push(`AI: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  let inserted = 0;

  for (const a of found) {
    const m = analysisByUrl.get(a.url);
    const relevanceScore = m ? clamp(m.relevance_score) : a.relevance_score ?? null;
    const quality = a.source_quality ?? sourceQuality(a.source);
    const lowConfidence = a.low_confidence ?? (relevanceScore === null || (relevanceScore !== null && relevanceScore <= 3) || quality === "low");
    const { error } = await supabase.from("news_articles").upsert(
      {
        user_id: userId, scope: "portfolio",
        ticker: a.ticker, company_name: a.company_name, sector: a.sector,
        title: a.title, url: a.url, source: a.source, published_at: a.published_at, snippet: a.snippet,
        ai_summary: m?.summary ?? a.ai_summary ?? null,
        sentiment: m?.sentiment ?? a.sentiment ?? null,
        relevance_score: relevanceScore,
        why_it_matters: m?.why_it_matters ?? a.why_it_matters ?? null,
        thesis_impact: m?.possible_thesis_impact ?? a.thesis_impact ?? null,
        review_question: m?.suggested_user_review_question ?? a.review_question ?? null,
        category: m?.category ?? a.category ?? "general",
        source_quality: quality,
        link_reason: a.link_reason ?? m?.why_it_matters ?? null,
        low_confidence: lowConfidence,
        ignored: lowConfidence,
      },
      { onConflict: "user_id,url", ignoreDuplicates: true }
    );
    if (!error) inserted++;
  }

  for (const a of marketFound) {
    // Market articles are stored raw — no AI enrichment here. The Analyst Brief
    // button synthesises them on-demand so the cron runs for free.
    const relevanceScore = a.relevance_score ?? 5;
    const { error } = await supabase.from("news_articles").upsert(
      {
        user_id: userId, scope: "market",
        ticker: null, company_name: null, sector: null,
        title: a.title, url: a.url, source: a.source, published_at: a.published_at, snippet: a.snippet,
        ai_summary: null,
        sentiment: null,
        relevance_score: relevanceScore,
        category: a.category ?? "market",
        source_quality: a.source_quality ?? "medium",
        low_confidence: false,
        ignored: false,
      },
      { onConflict: "user_id,url", ignoreDuplicates: true }
    );
    if (!error) inserted++;
  }

  void skippedNoMatch; // tracked for API responses but not returned in the cron summary
  return { inserted, market: marketFound.length, holding: found.length, errors: errors.slice(0, 10) };
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
}

function clamp(n: number): number {
  return Math.max(1, Math.min(10, Math.round(Number(n) || 5)));
}

function sourceQuality(source: string): NewsSourceQuality {
  const s = source.toLowerCase();
  if (s.includes("psx.com.pk") || s.includes("pucars") || s.includes("company announcements")) return "high";
  if (["brecorder.com","dawn.com","profit.pakistantoday.com.pk","pakistantoday.com.pk","thenews.com.pk","tribune.com.pk","reuters.com","marketscreener.com"].some((d) => s.includes(d))) return "high";
  if (["financialtimes.com","ft.com","tradingview.com","investing.com","oilprice.com","developingtelecoms.com"].some((d) => s.includes(d))) return "medium";
  if (["facebook.com","x.com","twitter.com","linkedin.com","youtube.com"].some((d) => s.includes(d))) return "low";
  return "unknown";
}
