export type NewsCategory =
  | "general"
  | "company"
  | "earnings"
  | "dividend"
  | "result"
  | "corporate_announcement"
  | "policy"
  | "economy"
  | "regulatory"
  | "commodity"
  | "funds"
  | "forex"
  | "crypto"
  | "market"
  | "international"
  | "geopolitics";

export type NewsScope = "portfolio" | "market";

export type NewsSourceQuality = "high" | "medium" | "low" | "unknown";

export type NewsProvider =
  | "tavily"
  | "gdelt"
  | "psx-announcements"
  | "rss"
  | "google-news";

export interface NewsHolding {
  ticker: string;
  company_name: string | null;
  sector: string | null;
}

export interface DiscoveredNewsArticle {
  url: string;
  title: string;
  snippet: string;
  /** Primary holding for portfolio-scope stories; null for market-scope stories. */
  ticker: string | null;
  company_name: string | null;
  sector: string | null;
  source: string;
  published_at: string | null;
  provider: NewsProvider;
  source_key?: string;
  scope: NewsScope;
  category?: NewsCategory;
  sentiment?: "positive" | "neutral" | "negative";
  relevance_score?: number;
  impact_tickers?: string[];
  is_interesting?: boolean;
  ai_summary?: string;
  why_it_matters?: string;
  thesis_impact?: string;
  review_question?: string;
  source_quality?: NewsSourceQuality;
  link_reason?: string;
  low_confidence?: boolean;
}
