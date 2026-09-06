/**
 * The contract for GET /api/portfolio/news.
 *
 * The same feed the web News Centre reads, selected and grouped by the shared
 * helpers in lib/news/feed so a "Suggested" tab means one thing on both
 * surfaces. Only what a phone can act on is sent: the full article body, the
 * image and the related-source list stay behind the link.
 */

export type NewsImportance = "Critical" | "High" | "Medium" | "Routine";

export interface NewsEventSummary {
  /** The event's own id: a cluster key, stable but not a row anywhere. */
  id: string;
  /**
   * The row the save and ignore actions write against. An event can group
   * several reports of the same story, so this is the article it was built
   * from, and it is NOT interchangeable with `id`.
   */
  articleId: string;
  /** Which table that row lives in; the two actions write to different ones. */
  storage: "global" | "legacy";
  title: string;
  summary: string | null;
  url: string;
  source: string;
  category: string;
  importance: NewsImportance;
  verification: string;
  suggested: boolean;
  whySuggested: string | null;
  affectedHoldings: string[];
  affectedSectors: string[];
  whatToWatch: string[];
  timeLabel: string;
  dateKey: string;
  timestamp: number;
  relatedCount: number;
  saved: boolean;
  lowConfidence: boolean;
  /** The first affected sector's colour, or null when nothing is implicated. */
  color: string | null;
}

export interface NewsDateGroup {
  dateKey: string;
  /** "Today", "Yesterday", then the weekday and date. */
  label: string;
  events: NewsEventSummary[];
}

export interface NewsSymbol {
  ticker: string;
  /** Today's move, when the ticker is priced. */
  move: number | null;
  /** How many events in the current view mention it. */
  count: number;
}

export interface NewsUpcoming {
  id: string;
  date: string;
  title: string;
  topic: string;
  relevance: string;
  href: string | null;
}

export interface NewsTabCount {
  id: string;
  label: string;
  count: number;
}

export interface NewsResponse {
  /** The one event worth reading first, when the tab has one. */
  featured: NewsEventSummary | null;
  groups: NewsDateGroup[];
  tabs: NewsTabCount[];
  symbols: NewsSymbol[];
  upcoming: NewsUpcoming[];
  /** Published since the last visit to this surface. */
  newSinceLastVisit: number;
  importantCount: number;
  /** How the sources are doing, in a sentence. */
  sourceHealth: string;
  count: number;
}

/**
 * The request contract for POST /api/news/article-action.
 *
 * `id` is the article row (NewsEventSummary.articleId), never the event's
 * cluster id, and `storage` says which table that row lives in.
 */
export interface ArticleActionRequest {
  id: string;
  storage: NewsEventSummary["storage"];
  field: "saved" | "ignored";
  value: boolean;
}
