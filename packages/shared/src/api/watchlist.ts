/**
 * The request contract for POST /api/stocks/watchlist.
 *
 * One route serves add, remove and toggle so the star on a company screen can
 * be a single call whatever state it is in. Omitting the action means toggle.
 */

export type WatchlistAction = "add" | "remove" | "toggle";

export interface WatchlistWriteRequest {
  ticker: string;
  action?: WatchlistAction;
}

export interface WatchlistWriteResponse {
  watched: boolean;
  message: string;
}
