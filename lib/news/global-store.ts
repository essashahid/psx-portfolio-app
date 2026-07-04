import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEED_SOURCES, QUERY_SOURCES } from "@/lib/news/sources";
import type { DiscoveredNewsArticle, NewsSourceQuality } from "@/lib/news/types";
import type { NewsArticle } from "@/lib/types";

type Db = SupabaseClient;

type GlobalNewsRow = {
  id: string;
  url: string;
  title: string;
  source: string | null;
  source_key: string | null;
  published_at: string | null;
  snippet: string | null;
  provider: string | null;
  scope: "portfolio" | "market";
  category: string | null;
  source_quality: NewsSourceQuality | null;
  ai_summary: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  relevance_score: number | null;
  impact_tickers: string[] | null;
  is_interesting: boolean;
  low_confidence: boolean;
  created_at: string;
};

type RelevanceRow = {
  id: string;
  user_id: string;
  article_id: string;
  ticker: string | null;
  company_name: string | null;
  sector: string | null;
  ai_summary: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  relevance_score: number | null;
  why_it_matters: string | null;
  thesis_impact: string | null;
  review_question: string | null;
  link_reason: string | null;
  low_confidence: boolean;
  saved: boolean;
  ignored: boolean;
  created_at: string;
  updated_at: string;
};

export type NewsStorage = "global" | "legacy";

export type FeedNewsArticle = NewsArticle & {
  storage: NewsStorage;
  global_article_id: string | null;
  legacy_article_id: string | null;
};

export type ArticleAnalysis = {
  summary?: string;
  sentiment?: "positive" | "neutral" | "negative";
  relevance_score?: number;
  why_it_matters?: string;
  possible_thesis_impact?: string;
  suggested_user_review_question?: string;
  category?: string;
};

export function newsWriteClient(): Db | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
}

export async function syncNewsSources(db: Db): Promise<void> {
  const rows = [
    ...FEED_SOURCES.map((s) => ({
      key: s.key,
      source_type: "feed",
      name: s.name,
      url: s.url,
      query: null,
      category: s.category,
      asset_class: s.assetClass,
      tier: s.tier,
      jurisdiction: s.jurisdiction,
      region: null,
      max_items: s.maxItems,
      enabled: true,
      updated_at: new Date().toISOString(),
    })),
    ...QUERY_SOURCES.map((s) => ({
      key: s.key,
      source_type: "query",
      name: s.topic,
      url: null,
      query: s.query,
      category: s.category,
      asset_class: s.assetClass,
      tier: "aggregator",
      jurisdiction: null,
      region: s.region,
      max_items: s.maxItems,
      enabled: true,
      updated_at: new Date().toISOString(),
    })),
  ];

  await db.from("news_sources").upsert(rows, { onConflict: "key" });
}

export async function saveGlobalArticle(
  db: Db,
  article: DiscoveredNewsArticle,
  patch: Partial<{
    ai_summary: string | null;
    sentiment: "positive" | "neutral" | "negative" | null;
    relevance_score: number | null;
    category: string | null;
    source_quality: NewsSourceQuality | null;
    low_confidence: boolean;
  }> = {}
): Promise<string | null> {
  const materiality = materialityScore(article, patch.relevance_score ?? article.relevance_score ?? null);
  const { data, error } = await db
    .from("global_news_articles")
    .upsert(
      {
        url: article.url,
        title: article.title,
        source: article.source,
        source_key: article.source_key ?? null,
        published_at: article.published_at,
        snippet: article.snippet,
        provider: article.provider,
        scope: article.scope,
        category: patch.category ?? article.category ?? "general",
        source_quality: patch.source_quality ?? article.source_quality ?? "unknown",
        ai_summary: patch.ai_summary ?? article.ai_summary ?? null,
        sentiment: patch.sentiment ?? article.sentiment ?? null,
        relevance_score: patch.relevance_score ?? article.relevance_score ?? null,
        impact_tickers: article.impact_tickers ?? (article.ticker ? [article.ticker] : null),
        is_interesting: article.is_interesting ?? materiality >= 8,
        low_confidence: patch.low_confidence ?? article.low_confidence ?? false,
        event_key: eventKey(article),
        materiality_score: materiality,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "url" }
    )
    .select("id")
    .single();

  if (error) return null;
  return (data?.id as string | undefined) ?? null;
}

export async function saveArticleRelevance(
  db: Db,
  userId: string,
  articleId: string,
  article: DiscoveredNewsArticle,
  analysis: ArticleAnalysis | null,
  opts: { relevanceScore: number | null; lowConfidence: boolean; sourceQuality: NewsSourceQuality | null }
): Promise<void> {
  await db.from("news_article_relevance").upsert(
    {
      user_id: userId,
      article_id: articleId,
      ticker: article.ticker,
      company_name: article.company_name,
      sector: article.sector,
      ai_summary: analysis?.summary ?? article.ai_summary ?? null,
      sentiment: analysis?.sentiment ?? article.sentiment ?? null,
      relevance_score: opts.relevanceScore,
      why_it_matters: analysis?.why_it_matters ?? article.why_it_matters ?? null,
      thesis_impact: analysis?.possible_thesis_impact ?? article.thesis_impact ?? null,
      review_question: analysis?.suggested_user_review_question ?? article.review_question ?? null,
      link_reason: article.link_reason ?? analysis?.why_it_matters ?? null,
      low_confidence: opts.lowConfidence,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,article_id" }
  );
}

export async function getUserNewsFeed(db: Db, userId: string, limit = 180): Promise<FeedNewsArticle[]> {
  try {
    const [marketRes, relevanceRes, legacyRes] = await Promise.all([
      db
        .from("global_news_articles")
        .select("*")
        .eq("scope", "market")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(limit),
      db
        .from("news_article_relevance")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(limit),
      legacyNews(db, userId, limit),
    ]);

    if (marketRes.error || relevanceRes.error) throw marketRes.error ?? relevanceRes.error;

    const relevanceRows = (relevanceRes.data ?? []) as RelevanceRow[];
    const articleIds = [...new Set(relevanceRows.map((r) => r.article_id))];
    const articleRows = articleIds.length
      ? await db.from("global_news_articles").select("*").in("id", articleIds)
      : { data: [], error: null };
    if (articleRows.error) throw articleRows.error;

    const relByArticle = new Map(relevanceRows.map((r) => [r.article_id, r]));
    const globalById = new Map(((articleRows.data ?? []) as GlobalNewsRow[]).map((r) => [r.id, r]));
    const out: FeedNewsArticle[] = [];
    const seen = new Set<string>();

    for (const rel of relevanceRows) {
      const global = globalById.get(rel.article_id);
      if (!global) continue;
      const article = composeGlobalArticle(global, rel);
      if (article.ignored && !article.saved) continue;
      out.push(article);
      seen.add(global.id);
    }

    for (const global of (marketRes.data ?? []) as GlobalNewsRow[]) {
      if (seen.has(global.id)) continue;
      const article = composeGlobalArticle(global, relByArticle.get(global.id) ?? null);
      if (article.ignored && !article.saved) continue;
      out.push(article);
      seen.add(global.id);
    }

    for (const legacy of legacyRes) {
      if (out.some((a) => a.url === legacy.url)) continue;
      out.push(legacy);
    }

    return out.sort((a, b) => articleTime(b) - articleTime(a)).slice(0, limit);
  } catch {
    return legacyNews(db, userId, limit);
  }
}

async function legacyNews(db: Db, userId: string, limit: number): Promise<FeedNewsArticle[]> {
  const { data } = await db
    .from("news_articles")
    .select("*")
    .eq("user_id", userId)
    .or("ignored.eq.false,saved.eq.true")
    .order("created_at", { ascending: false })
    .limit(limit);

  return ((data ?? []) as NewsArticle[]).map((row) => ({
    ...row,
    storage: "legacy",
    global_article_id: null,
    legacy_article_id: row.id,
  }));
}

function composeGlobalArticle(global: GlobalNewsRow, rel: RelevanceRow | null): FeedNewsArticle {
  return {
    id: global.id,
    storage: "global",
    global_article_id: global.id,
    legacy_article_id: null,
    ticker: rel?.ticker ?? null,
    company_name: rel?.company_name ?? null,
    sector: rel?.sector ?? null,
    title: global.title,
    url: global.url,
    source: global.source,
    published_at: global.published_at,
    snippet: global.snippet,
    ai_summary: rel?.ai_summary ?? global.ai_summary,
    sentiment: rel?.sentiment ?? global.sentiment,
    relevance_score: rel?.relevance_score ?? global.relevance_score,
    why_it_matters: rel?.why_it_matters ?? null,
    thesis_impact: rel?.thesis_impact ?? null,
    review_question: rel?.review_question ?? null,
    category: global.category,
    scope: global.scope,
    impact_tickers: global.impact_tickers,
    is_interesting: global.is_interesting,
    source_quality: global.source_quality,
    link_reason: rel?.link_reason ?? null,
    low_confidence: rel?.low_confidence ?? global.low_confidence,
    saved: rel?.saved ?? false,
    ignored: rel?.ignored ?? false,
    created_at: global.created_at,
  };
}

function articleTime(a: NewsArticle): number {
  const t = new Date(a.published_at ?? a.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function eventKey(article: DiscoveredNewsArticle): string {
  // Portfolio-scope stories are keyed per company so one holding's dividend and
  // another's result never collapse into the same cluster; market stories cluster
  // purely by topic.
  const prefix = article.scope === "portfolio" && article.ticker ? `${article.ticker.toLowerCase()}:` : "";
  const text = `${prefix}${article.category ?? "general"}:${article.title}`
    .toLowerCase()
    .replace(/\b(pakistan|psx|kse|stock|market|latest|update)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 90)
    .replace(/\s+/g, "-");
  return text || "general";
}

// ---------------------------------------------------------------------------
// Persisted event clusters (news_event_clusters). One row per de-duplicated
// story so the dashboard, stock page and Copilot read a shared, compressed view
// instead of re-clustering per request.
// ---------------------------------------------------------------------------

export type NewsCluster = {
  id: string;
  event_key: string;
  category: string | null;
  ticker: string | null;
  title: string;
  url: string | null;
  materiality_score: number;
  article_count: number;
  impact_tickers: string[] | null;
  scope: string;
  first_published_at: string | null;
  last_published_at: string | null;
};

/** Recompute the shared cluster table. Call once per refresh cycle, not per user. */
export async function syncNewsClusters(db: Db, sinceDays = 45): Promise<number> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db.rpc("sync_news_clusters", { p_since: since });
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

/** Clusters that touch any of the given tickers, most recent first. */
export async function getClustersForTickers(
  db: Db,
  tickers: string[],
  opts: { categories?: string[]; limit?: number } = {}
): Promise<NewsCluster[]> {
  if (tickers.length === 0) return [];
  const upper = tickers.map((t) => t.toUpperCase());
  let query = db
    .from("news_event_clusters")
    .select("*")
    .overlaps("impact_tickers", upper)
    .order("last_published_at", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 20);
  if (opts.categories?.length) query = query.in("category", opts.categories);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as NewsCluster[];
}

/** Clusters for a single ticker (its research-page timeline). */
export async function getClustersForTicker(db: Db, ticker: string, limit = 12): Promise<NewsCluster[]> {
  return getClustersForTickers(db, [ticker], { limit });
}

function materialityScore(article: DiscoveredNewsArticle, relevance: number | null): number {
  let score = relevance ?? (article.scope === "market" ? 6 : 5);
  if (article.source_quality === "high") score += 1;
  if (article.category && ["policy", "regulatory", "economy", "market", "commodity", "forex"].includes(article.category)) score += 1;
  if (article.is_interesting) score += 2;
  return Math.max(1, Math.min(10, Math.round(score)));
}
