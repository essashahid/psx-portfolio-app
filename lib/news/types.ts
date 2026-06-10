export type NewsCategory = "general" | "dividend" | "result" | "corporate_announcement";
export type NewsSourceQuality = "high" | "medium" | "low" | "unknown";

export interface NewsHolding {
  ticker: string;
  company_name: string | null;
  sector: string | null;
}

export interface DiscoveredNewsArticle {
  url: string;
  title: string;
  snippet: string;
  ticker: string;
  company_name: string;
  sector: string | null;
  source: string;
  published_at: string | null;
  provider: "tavily" | "gdelt" | "psx-announcements";
  category?: NewsCategory;
  sentiment?: "positive" | "neutral" | "negative";
  relevance_score?: number;
  ai_summary?: string;
  why_it_matters?: string;
  thesis_impact?: string;
  review_question?: string;
  source_quality?: NewsSourceQuality;
  link_reason?: string;
  low_confidence?: boolean;
}
