import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { tavilySearch, holdingQueries, tavilyConfigured } from "@/lib/tavily";
import { analyzeArticles, aiConfigured, type ArticleAnalysis } from "@/lib/ai/openai";
import { refreshAlerts } from "@/lib/alerts";

export const maxDuration = 300;

const MAX_HOLDINGS_PER_RUN = 12;

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!tavilyConfigured()) {
    return NextResponse.json(
      { error: "TAVILY_API_KEY is not configured. Add it in .env.local to enable news refresh." },
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

      const found: {
        url: string;
        title: string;
        snippet: string;
        ticker: string;
        company_name: string;
        sector: string | null;
        source: string;
        published_at: string | null;
      }[] = [];

      const searchErrors: string[] = [];
      // distinct sector queries (one per sector, not per holding)
      const sectors = [...new Set(holdings.map((h) => h.sector).filter(Boolean))] as string[];

      for (const h of holdings) {
        for (const q of holdingQueries(h)) {
          try {
            const results = await tavilySearch(q, { days: 7, maxResults: 4 });
            for (const r of results) {
              if (known.has(r.url)) continue;
              known.add(r.url);
              found.push({
                url: r.url,
                title: r.title,
                snippet: (r.content ?? "").slice(0, 1500),
                ticker: h.ticker,
                company_name: h.company_name ?? h.ticker,
                sector: h.sector,
                source: safeHostname(r.url),
                published_at: r.published_date ?? null,
              });
            }
          } catch (e) {
            searchErrors.push(`${h.ticker}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      if (!body.ticker) {
        for (const sector of sectors.slice(0, 5)) {
          try {
            const results = await tavilySearch(`${sector} Pakistan latest news`, { days: 7, maxResults: 3 });
            const h = holdings.find((x) => x.sector === sector)!;
            for (const r of results) {
              if (known.has(r.url)) continue;
              known.add(r.url);
              found.push({
                url: r.url,
                title: r.title,
                snippet: (r.content ?? "").slice(0, 1500),
                ticker: h.ticker,
                company_name: h.company_name ?? h.ticker,
                sector,
                source: safeHostname(r.url),
                published_at: r.published_date ?? null,
              });
            }
          } catch (e) {
            searchErrors.push(`${sector}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      // AI analysis in batches of 8 (skipped gracefully when no key configured)
      const portfolioContext = holdings
        .map((h) => `${h.ticker} = ${h.company_name} (${h.sector ?? "sector unknown"})`)
        .join("\n");
      const analysisByUrl = new Map<string, ArticleAnalysis>();
      let aiSkipped = false;
      if (aiConfigured()) {
        for (let i = 0; i < found.length; i += 8) {
          const batch = found.slice(i, i + 8);
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
      for (const a of found) {
        const analysis = analysisByUrl.get(a.url);
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
            ai_summary: analysis?.summary ?? null,
            sentiment: analysis?.sentiment ?? null,
            relevance_score: analysis ? clampScore(analysis.relevance_score) : null,
            why_it_matters: analysis?.why_it_matters ?? null,
            thesis_impact: analysis?.possible_thesis_impact ?? null,
            review_question: analysis?.suggested_user_review_question ?? null,
            category: analysis?.category ?? "general",
          },
          { onConflict: "user_id,url", ignoreDuplicates: true }
        );
        if (!insErr) inserted++;
      }

      await refreshAlerts(supabase, user.id);

      return {
        searched: holdings.length,
        found: found.length,
        inserted,
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
