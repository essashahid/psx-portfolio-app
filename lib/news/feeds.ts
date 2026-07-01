import { fetchRssFeed, type RssItem } from "@/lib/news/rss";
import {
  FEED_SOURCES,
  QUERY_SOURCES,
  googleNewsUrl,
  marketNewsConfigured,
  sectorQuery,
  type FeedSource,
  type QuerySource,
} from "@/lib/news/sources";
import type { DiscoveredNewsArticle, NewsHolding } from "@/lib/news/types";

/**
 * The "market lane": macro, policy, regulatory, sector, commodity, forex,
 * crypto and global news that moves the PSX even when it isn't about a single
 * holding. Holding-independent by design — coverage no longer depends on whose
 * portfolio triggered the refresh. All sources are free and defined in the
 * global registry (`lib/news/sources.ts`).
 */

// Re-exported so existing importers keep working after the registry move.
export { marketNewsConfigured, googleNewsUrl };

export async function fetchMarketNews(
  holdings: NewsHolding[],
  opts: { maxArticles?: number } = {}
): Promise<{ articles: DiscoveredNewsArticle[]; errors: string[] }> {
  const articles: DiscoveredNewsArticle[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  function add(article: DiscoveredNewsArticle) {
    const key = dedupeKey(article.url, article.title);
    if (seen.has(key)) return;
    seen.add(key);
    articles.push(article);
  }

  // 1) Direct publisher feeds (Pakistan wires + a thin global layer).
  await Promise.all(
    FEED_SOURCES.map(async (feed) => {
      try {
        const items = await fetchRssFeed(feed.url);
        for (const item of items.slice(0, feed.maxItems)) add(feedToArticle(item, feed));
      } catch (err) {
        errors.push(`RSS ${feed.name} (${feed.key}): ${message(err)}`);
      }
    })
  );

  // 2) Standing discovery queries (regulators, commodities, forex, funds,
  //    global macro) plus one query per distinct portfolio sector.
  const sectorQueries = [...new Set(holdings.map((h) => h.sector).filter(Boolean) as string[])]
    .slice(0, 5)
    .map(sectorQuery);
  const queries = [...QUERY_SOURCES, ...sectorQueries];

  await Promise.all(
    queries.map(async (q) => {
      try {
        const items = await fetchRssFeed(googleNewsUrl(q.query, q.region));
        for (const item of items.slice(0, q.maxItems)) add(googleNewsToArticle(item, q));
      } catch (err) {
        errors.push(`Google News "${q.topic}": ${message(err)}`);
      }
    })
  );

  const max = opts.maxArticles ?? 120;
  const sorted = articles.sort((a, b) => timestamp(b.published_at) - timestamp(a.published_at)).slice(0, max);
  return { articles: sorted, errors };
}

function feedToArticle(item: RssItem, feed: FeedSource): DiscoveredNewsArticle {
  return {
    url: item.link,
    title: item.title,
    snippet: item.description.slice(0, 1200) || item.title,
    ticker: null,
    company_name: null,
    sector: null,
    source: feed.name,
    published_at: item.pubDate,
    provider: "rss",
    scope: "market",
    category: feed.category,
    source_quality: feed.tier === "aggregator" ? "medium" : "high",
    low_confidence: false,
  };
}

function googleNewsToArticle(item: RssItem, q: QuerySource): DiscoveredNewsArticle {
  const source = item.source ?? "Google News";
  // Google News appends " - Outlet" to titles; drop it for a clean headline.
  const title =
    item.source && item.title.endsWith(` - ${item.source}`)
      ? item.title.slice(0, -(item.source.length + 3))
      : item.title;
  return {
    url: item.link,
    title,
    snippet: item.description.slice(0, 1200) || title,
    ticker: null,
    company_name: null,
    sector: null,
    source,
    published_at: item.pubDate,
    provider: "google-news",
    scope: "market",
    category: q.category,
    source_quality: "medium",
    low_confidence: false,
  };
}

function dedupeKey(url: string, title: string): string {
  return `${url.split("?")[0]}::${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}`;
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
