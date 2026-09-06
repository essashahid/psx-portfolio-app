/**
 * The request contract for POST /api/prefs.
 *
 * profiles.prefs is a small jsonb bag of owner-only UI state. The route only
 * accepts the keys listed here and merges dismissed_checks into the existing
 * map rather than replacing it. Anything else in the body is dropped.
 */

export interface PrefsPatchRequest {
  /** ISO timestamp of the last visit to the news surface. */
  news_last_seen_at?: string;
  /** ISO timestamp of the last visit to the dashboard. */
  dashboard_last_seen_at?: string;
  /** Map of check id to the ISO timestamp it was dismissed at. */
  dismissed_checks?: Record<string, string>;
}

export interface PrefsPatchResponse {
  ok: boolean;
  /** Set when nothing in the body was an accepted key. */
  reason?: string;
}
