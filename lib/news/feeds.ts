import { fetchRssFeed, type RssItem } from "@/lib/news/rss";
import type { DiscoveredNewsArticle, NewsCategory, NewsHolding } from "@/lib/news/types";

/**
 * The "market lane": macro, policy, sector, commodity and international news
 * that moves the PSX even when it isn't about a single holding. All free, no
 * API key — the Pakistani business wires publish RSS, and Google News RSS is a
 * query-driven firehose across Dawn, Tribune, Reuters, BBC, Arab News, etc.
 */

// Curated Pakistani business wires — already PSX/macro focused, high signal.
const CURATED_FEEDS: { url: string; source: string; category: NewsCategory }[] = [
  { url: "https://www.brecorder.com/feeds/markets", source: "Business Recorder", category: "market" },
  { url: "https://www.brecorder.com/feeds/latest-news", source: "Business Recorder", category: "economy" },
  { url: "https://www.dawn.com/feeds/business", source: "Dawn", category: "economy" },
  { url: "https://tribune.com.pk/feed/business", source: "The Express Tribune", category: "market" },
];

// Standing macro queries run through Google News (international + local mix).
const MACRO_QUERIES: { query: string; category: NewsCategory }[] = [
  { query: "KSE-100 OR \"Pakistan Stock Exchange\" market", category: "market" },
  { query: "Pakistan IMF OR budget OR \"finance bill\" OR taxation policy", category: "policy" },
  { query: "State Bank Pakistan interest rate OR \"monetary policy\" OR inflation OR rupee", category: "economy" },
  { query: "Pakistan oil OR gas OR fuel price OR petroleum", category: "commodity" },
  { query: "Pakistan foreign investment OR remittances OR forex reserves", category: "economy" },
];

const MAX_PER_FEED = 14;
const MAX_PER_QUERY = 6;

export function marketNewsConfigured(): boolean {
  return process.env.NEWS_ENABLE_MARKET !== "false";
}

export function googleNewsUrl(query: string): string {
  const params = new URLSearchParams({ q: `${query} when:7d`, hl: "en-PK", gl: "PK", ceid: "PK:en" });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

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

  // 1) Curated business-wire RSS.
  await Promise.all(
    CURATED_FEEDS.map(async (feed) => {
      try {
        const items = await fetchRssFeed(feed.url);
        for (const item of items.slice(0, MAX_PER_FEED)) {
          add(rssToArticle(item, feed.source, feed.category));
        }
      } catch (err) {
        errors.push(`RSS ${feed.source}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  // 2) Standing macro queries + one query per portfolio sector, via Google News.
  const sectorQueries = [...new Set(holdings.map((h) => h.sector).filter(Boolean))]
    .slice(0, 4)
    .map((sector) => ({ query: `Pakistan ${sector} sector`, category: "economy" as NewsCategory }));
  const queries = [...MACRO_QUERIES, ...sectorQueries];

  await Promise.all(
    queries.map(async ({ query, category }) => {
      try {
        const items = await fetchRssFeed(googleNewsUrl(query));
        for (const item of items.slice(0, MAX_PER_QUERY)) {
          add(googleNewsToArticle(item, category));
        }
      } catch (err) {
        errors.push(`Google News "${query.slice(0, 40)}": ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  const max = opts.maxArticles ?? 45;
  const sorted = articles.sort((a, b) => timestamp(b.published_at) - timestamp(a.published_at)).slice(0, max);
  return { articles: sorted, errors };
}

function rssToArticle(item: RssItem, source: string, category: NewsCategory): DiscoveredNewsArticle {
  return {
    url: item.link,
    title: item.title,
    snippet: item.description.slice(0, 1200) || item.title,
    ticker: null,
    company_name: null,
    sector: null,
    source,
    published_at: item.pubDate,
    provider: "rss",
    scope: "market",
    category,
    source_quality: "high",
    low_confidence: false,
  };
}

function googleNewsToArticle(item: RssItem, category: NewsCategory): DiscoveredNewsArticle {
  const source = item.source ?? "Google News";
  // Google News appends " - Outlet" to titles; drop it for a clean headline.
  const title = item.source && item.title.endsWith(` - ${item.source}`)
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
    category,
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
