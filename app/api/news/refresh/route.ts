import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { tavilySearch, holdingQueries, tavilyConfigured } from "@/lib/tavily";
import { analyzeArticles, aiConfigured, type ArticleAnalysis } from "@/lib/ai/openai";
import { refreshAlerts } from "@/lib/alerts";
import { gdeltConfigured, gdeltSearchHoldings } from "@/lib/news/gdelt";
import { matchesHoldingText } from "@/lib/news/matching";
import { psxAnnouncementsConfigured, psxAnnouncementSearchHoldings } from "@/lib/news/psx-announcements";
import type { DiscoveredNewsArticle } from "@/lib/news/types";

export const maxDuration = 300;

const MAX_HOLDINGS_PER_RUN = 12;

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const tavilyEnabled = tavilyConfigured() && process.env.NEWS_ENABLE_TAVILY !== "false";
  const psxAnnouncementsEnabled = psxAnnouncementsConfigured();
  const gdeltEnabled = gdeltConfigured();

  if (!tavilyEnabled && !psxAnnouncementsEnabled && !gdeltEnabled) {
    return NextResponse.json(
      { error: "No news providers are enabled. Enable Tavily, GDELT, or PSX announcements." },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { ticker?: string };

    let query = supabase
      .from("holdings")
      .select("ticker, company_name, sector")
      .eq("user_id", user.id)
      .gt("quantity", 0)
      .order("ticker")
      .limit(MAX_HOLDINGS_PER_RUN);
    if (body.ticker) query = query.eq("ticker", body.ticker);
    const { data: holdings } = await query;

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({ error: "No holdings to search news for." }, { status: 422 });
    }

    const output = await logAgentRun(supabase, user.id, "news_refresh", { ticker: body.ticker ?? "all" }, async () => {
      // existing URLs for dedupe
      const { data: existing } = await supabase
        .from("news_articles")
        .select("url")
        .eq("user_id", user.id);
      const known = new Set((existing ?? []).map((e) => e.url));

      const found: DiscoveredNewsArticle[] = [];

      const searchErrors: string[] = [];
      let skippedNoHoldingMatch = 0;
      const providerCounts = {
        tavily: 0,
        gdelt: 0,
        psxAnnouncements: 0,
      };

      function addArticle(article: DiscoveredNewsArticle) {
        if (known.has(article.url)) return false;
        known.add(article.url);
        found.push(article);
        if (article.provider === "tavily") providerCounts.tavily++;
        if (article.provider === "gdelt") providerCounts.gdelt++;
        if (article.provider === "psx-announcements") providerCounts.psxAnnouncements++;
        return true;
      }

      if (psxAnnouncementsEnabled) {
        const { articles, errors } = await psxAnnouncementSearchHoldings(holdings, { maxResultsPerHolding: 4 });
        for (const article of articles) addArticle(article);
        searchErrors.push(...errors);
      }

      if (tavilyEnabled) {
        for (const h of holdings) {
          for (const q of holdingQueries(h)) {
            try {
              const results = await tavilySearch(q, { days: 7, maxResults: 4 });
              for (const r of results) {
                if (!matchesHoldingText(h, [r.title, r.content ?? "", r.url])) {
                  skippedNoHoldingMatch++;
                  continue;
                }
                addArticle({
                  url: r.url,
                  title: r.title,
                  snippet: (r.content ?? "").slice(0, 1500),
                  ticker: h.ticker,
                  company_name: h.company_name ?? h.ticker,
                  sector: h.sector,
                  source: safeHostname(r.url),
                  published_at: r.published_date ?? null,
                  provider: "tavily",
                  category: "general",
                });
              }
            } catch (e) {
              searchErrors.push(`${h.ticker} Tavily: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }

      if (gdeltEnabled) {
        const { articles, errors } = await gdeltSearchHoldings(holdings, { days: 7, maxResultsPerHolding: 2 });
        for (const article of articles) addArticle(article);
        searchErrors.push(...errors);
      }

      // AI analysis in batches of 8 (skipped gracefully when no key configured)
      const portfolioContext = holdings
        .map((h) => `${h.ticker} = ${h.company_name} (${h.sector ?? "sector unknown"})`)
        .join("\n");
      const analysisByUrl = new Map<string, ArticleAnalysis>();
      const aiCandidates = found.filter((article) => article.provider !== "psx-announcements");
      let aiSkipped = false;
      if (aiConfigured()) {
        for (let i = 0; i < aiCandidates.length; i += 8) {
          const batch = aiCandidates.slice(i, i + 8);
          try {
            const { analyses } = await analyzeArticles(
              batch.map((a) => ({
                url: a.url,
                title: a.title,
                snippet: a.snippet,
                ticker: a.ticker,
                company_name: a.company_name,
              })),
              portfolioContext
            );
            for (const a of analyses) analysisByUrl.set(a.url, a);
          } catch (e) {
            searchErrors.push(`AI analysis: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } else {
        aiSkipped = true;
      }

      let inserted = 0;
      let autoIgnored = 0;
      for (const a of found) {
        const analysis = analysisByUrl.get(a.url);
        const relevanceScore = analysis ? clampScore(analysis.relevance_score) : a.relevance_score ?? null;
        const shouldAutoIgnore = relevanceScore !== null && relevanceScore <= 2;
        const { error: insErr } = await supabase.from("news_articles").upsert(
          {
            user_id: user.id,
            ticker: a.ticker,
            company_name: a.company_name,
            sector: a.sector,
            title: a.title,
            url: a.url,
            source: a.source,
            published_at: a.published_at,
            snippet: a.snippet,
            ai_summary: analysis?.summary ?? a.ai_summary ?? null,
            sentiment: analysis?.sentiment ?? a.sentiment ?? null,
            relevance_score: relevanceScore,
            why_it_matters: analysis?.why_it_matters ?? a.why_it_matters ?? null,
            thesis_impact: analysis?.possible_thesis_impact ?? a.thesis_impact ?? null,
            review_question: analysis?.suggested_user_review_question ?? a.review_question ?? null,
            category: analysis?.category ?? a.category ?? "general",
            ignored: shouldAutoIgnore,
          },
          { onConflict: "user_id,url", ignoreDuplicates: true }
        );
        if (!insErr) {
          inserted++;
          if (shouldAutoIgnore) autoIgnored++;
        }
      }

      await refreshAlerts(supabase, user.id);

      return {
        message: `${inserted} article${inserted === 1 ? "" : "s"} saved. ${skippedNoHoldingMatch} off-topic match${skippedNoHoldingMatch === 1 ? "" : "es"} skipped.`,
        searched: holdings.length,
        found: found.length,
        inserted,
        autoIgnored,
        skippedNoHoldingMatch,
        providers: providerCounts,
        aiSkipped,
        errors: searchErrors.slice(0, 10),
      };
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

function clampScore(n: number): number {
  return Math.max(1, Math.min(10, Math.round(Number(n) || 5)));
}
