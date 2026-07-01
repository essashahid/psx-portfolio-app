import type { NewsCategory } from "@/lib/news/types";

/**
 * Global source registry.
 *
 * The market lane is holding-independent: it pulls the whole Pakistan + global
 * financial picture once, regardless of whose portfolio triggered the refresh.
 * Every entry here has been confirmed reachable and returning items. Two kinds
 * of source:
 *
 *   FeedSource   — a direct RSS/Atom endpoint from a publisher.
 *   QuerySource  — a standing Google News query, used as a discovery firehose
 *                  for topics with no reliable first-party feed (regulators,
 *                  commodities, forex). Google News aggregates Dawn, Tribune,
 *                  Reuters, BR, Arab News, Bloomberg-linked coverage, etc.
 *
 * This is the code-level registry. A DB-backed `news_sources` table with health
 * tracking and per-source scheduling is the next phase; the shape here maps
 * cleanly onto it (slug/tier/category/asset_class/jurisdiction).
 */

export type AssetClass =
  | "equity"
  | "macro"
  | "policy"
  | "commodity"
  | "forex"
  | "crypto"
  | "funds"
  | "global";

export type SourceTier = "official" | "primary" | "reputable" | "aggregator";

export interface FeedSource {
  key: string;
  /** Outlet name shown to the reader. */
  name: string;
  url: string;
  category: NewsCategory;
  assetClass: AssetClass;
  tier: SourceTier;
  jurisdiction: "PK" | "global";
  maxItems: number;
}

export interface QuerySource {
  key: string;
  /** Human label for the topic (used for logging, not shown). */
  topic: string;
  query: string;
  category: NewsCategory;
  assetClass: AssetClass;
  region: "PK" | "global";
  maxItems: number;
}

/**
 * Direct publisher feeds. Pakistan business wires first (highest signal for a
 * PSX investor), then a thin global markets layer.
 */
export const FEED_SOURCES: FeedSource[] = [
  // Pakistan business wires.
  { key: "br-markets", name: "Business Recorder", url: "https://www.brecorder.com/feeds/markets", category: "market", assetClass: "equity", tier: "primary", jurisdiction: "PK", maxItems: 14 },
  { key: "br-business-finance", name: "Business Recorder", url: "https://www.brecorder.com/feeds/business-finance", category: "economy", assetClass: "macro", tier: "primary", jurisdiction: "PK", maxItems: 12 },
  { key: "br-pakistan", name: "Business Recorder", url: "https://www.brecorder.com/feeds/pakistan", category: "economy", assetClass: "macro", tier: "primary", jurisdiction: "PK", maxItems: 8 },
  { key: "br-world", name: "Business Recorder", url: "https://www.brecorder.com/feeds/world", category: "international", assetClass: "global", tier: "primary", jurisdiction: "PK", maxItems: 6 },
  { key: "dawn-business", name: "Dawn", url: "https://www.dawn.com/feeds/business", category: "economy", assetClass: "macro", tier: "primary", jurisdiction: "PK", maxItems: 12 },
  { key: "tribune-business", name: "The Express Tribune", url: "https://tribune.com.pk/feed/business", category: "market", assetClass: "equity", tier: "reputable", jurisdiction: "PK", maxItems: 10 },
  { key: "thenews-latest", name: "The News", url: "https://www.thenews.com.pk/rss/1/1", category: "general", assetClass: "macro", tier: "reputable", jurisdiction: "PK", maxItems: 8 },

  // Global markets / commodities / crypto — a thin, high-signal layer.
  { key: "dj-markets", name: "Wall Street Journal", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", category: "international", assetClass: "global", tier: "primary", jurisdiction: "global", maxItems: 6 },
  { key: "cnbc-markets", name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", category: "international", assetClass: "global", tier: "primary", jurisdiction: "global", maxItems: 6 },
  { key: "oilprice", name: "OilPrice", url: "https://oilprice.com/rss/main", category: "commodity", assetClass: "commodity", tier: "reputable", jurisdiction: "global", maxItems: 6 },
  { key: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", category: "crypto", assetClass: "crypto", tier: "reputable", jurisdiction: "global", maxItems: 5 },
];

/**
 * Standing discovery queries for topics without a reliable first-party feed.
 * Pakistan regulators and the central bank publish irregularly and block direct
 * RSS, so we let Google News surface their coverage from the wires.
 */
export const QUERY_SOURCES: QuerySource[] = [
  // Index & equities.
  { key: "kse100", topic: "KSE-100 index", query: "KSE-100 OR \"Pakistan Stock Exchange\" market", category: "market", assetClass: "equity", region: "PK", maxItems: 6 },

  // Central bank & monetary policy.
  { key: "sbp", topic: "State Bank of Pakistan", query: "\"State Bank of Pakistan\" monetary policy OR interest rate OR policy rate", category: "economy", assetClass: "macro", region: "PK", maxItems: 5 },
  { key: "inflation", topic: "Inflation & prices", query: "Pakistan inflation OR CPI OR \"sensitive price index\"", category: "economy", assetClass: "macro", region: "PK", maxItems: 4 },

  // Regulators.
  { key: "secp", topic: "SECP", query: "SECP Pakistan regulation OR circular OR listing", category: "regulatory", assetClass: "policy", region: "PK", maxItems: 4 },
  { key: "fbr", topic: "FBR / tax", query: "FBR Pakistan tax OR revenue OR budget measures", category: "regulatory", assetClass: "policy", region: "PK", maxItems: 4 },
  { key: "nepra-ogra", topic: "NEPRA / OGRA", query: "NEPRA OR OGRA Pakistan tariff OR gas price OR electricity price", category: "regulatory", assetClass: "policy", region: "PK", maxItems: 4 },

  // Fiscal & external.
  { key: "imf-budget", topic: "IMF & budget", query: "Pakistan IMF OR budget OR \"finance bill\" OR fiscal", category: "policy", assetClass: "policy", region: "PK", maxItems: 5 },
  { key: "external", topic: "Reserves & remittances", query: "Pakistan \"forex reserves\" OR remittances OR \"current account\"", category: "economy", assetClass: "macro", region: "PK", maxItems: 4 },

  // Funds & fixed income.
  { key: "mufap", topic: "Mutual funds", query: "MUFAP OR \"mutual fund\" Pakistan OR NAV OR \"T-bill\" OR \"PIB auction\"", category: "funds", assetClass: "funds", region: "PK", maxItems: 4 },

  // Commodities & energy.
  { key: "energy-pk", topic: "Energy & fuel", query: "Pakistan petrol OR diesel OR \"petroleum price\" OR LNG OR gas", category: "commodity", assetClass: "commodity", region: "PK", maxItems: 4 },
  { key: "gold", topic: "Gold & metals", query: "gold price Pakistan OR international gold OR silver", category: "commodity", assetClass: "commodity", region: "PK", maxItems: 3 },

  // Forex.
  { key: "pkr", topic: "Rupee", query: "PKR OR rupee dollar exchange rate Pakistan interbank", category: "forex", assetClass: "forex", region: "PK", maxItems: 3 },

  // Global macro & geopolitics.
  { key: "global-macro", topic: "Global macro", query: "Federal Reserve OR oil price OR global markets OR China economy", category: "geopolitics", assetClass: "global", region: "global", maxItems: 4 },
];

/**
 * A per-sector discovery query for each distinct sector in a portfolio. Kept
 * small — the broad lanes above already carry most sector signal.
 */
export function sectorQuery(sector: string): QuerySource {
  return {
    key: `sector-${sector.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    topic: `${sector} sector`,
    query: `Pakistan ${sector} sector`,
    category: "economy",
    assetClass: "macro",
    region: "PK",
    maxItems: 4,
  };
}

export function marketNewsConfigured(): boolean {
  return process.env.NEWS_ENABLE_MARKET !== "false";
}

/** Google News RSS search URL for a query, scoped to the last 7 days. */
export function googleNewsUrl(query: string, region: "PK" | "global" = "PK"): string {
  const locale =
    region === "PK"
      ? { hl: "en-PK", gl: "PK", ceid: "PK:en" }
      : { hl: "en-US", gl: "US", ceid: "US:en" };
  const params = new URLSearchParams({ q: `${query} when:7d`, ...locale });
  return `https://news.google.com/rss/search?${params.toString()}`;
}
