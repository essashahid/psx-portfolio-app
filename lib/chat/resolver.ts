import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deterministic, FREE pre-processing for a chat message — no LLM. Pulls out the
 * PSX tickers the user mentioned (validated against the real universe so common
 * words aren't mistaken for symbols) and a coarse intent, so the route can
 * gather the right data and render cards before (or instead of) an LLM call.
 */

export type Intent =
  | "position" // how does my X look / my holding
  | "valuation" // ratios, P/E, cheap/expensive
  | "dividend"
  | "technical" // chart, trend, 52-week, RSI
  | "news" // news / filings / what happened
  | "compare"
  | "market" // overall market / index / breadth
  | "overview"; // default — a bit of everything for a ticker

const STOPWORDS = new Set([
  "HOW", "DOES", "DO", "THE", "AND", "FOR", "ARE", "WAS", "WHAT", "WHEN", "WHY", "WHO",
  "MY", "ME", "IS", "IT", "OF", "ON", "IN", "TO", "VS", "AT", "AS", "BE", "OR", "IF",
  "LOOK", "LIKE", "SHOW", "TELL", "GIVE", "POSITION", "STOCK", "SHARE", "PRICE", "NEWS",
  "PSX", "BUY", "SELL", "HOLD", "GOOD", "BAD", "NOW", "TODAY", "WEEK", "YEAR", "PKR",
]);

export interface ResolvedMessage {
  tickers: string[];
  intent: Intent;
  sector: string | null;
}

/**
 * Match a sector the user named (e.g. "cement", "banks") against the sectors in
 * the latest snapshot. Cheap (~38 rows). A message word (≥4 chars) that is
 * contained in a sector name counts as a match, so "banks" → "Commercial Banks"
 * and "cement" → "Cement".
 */
async function resolveSector(supabase: SupabaseClient, message: string): Promise<string | null> {
  const { data: snap } = await supabase.from("market_snapshots").select("id").eq("market", "PSX").order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
  if (!snap) return null;
  const { data } = await supabase.from("sector_snapshots").select("sector").eq("snapshot_id", snap.id);
  const sectors = (data ?? []).map((r) => r.sector as string);
  const words = (message.toLowerCase().match(/[a-z&]{4,}/g) ?? []).filter((w) => !["sector", "today", "perform", "doing", "stocks", "shares"].includes(w));
  let best: string | null = null;
  for (const s of sectors) {
    const sl = s.toLowerCase();
    if (words.some((w) => sl.includes(w))) {
      // Prefer the shortest matching sector name (most specific).
      if (!best || s.length < best.length) best = s;
    }
  }
  return best;
}

function detectIntent(msg: string): Intent {
  const m = msg.toLowerCase();
  if (/\b(compare|versus|\bvs\b|against|better than)\b/.test(m)) return "compare";
  if (/\b(market|index|kse|breadth|overall|sentiment|sectors?|today'?s? (market|session))\b/.test(m) && !/\bmy\b/.test(m)) return "market";
  if (/\b(dividend|payout|yield|bonus)\b/.test(m)) return "dividend";
  if (/\b(p\/e|pe ratio|valuation|cheap|expensive|overvalued|undervalued|ratio|roe|roa|margin|fundamental)\b/.test(m)) return "valuation";
  if (/\b(chart|trend|technical|52[- ]?week|rsi|moving average|support|resistance|momentum)\b/.test(m)) return "technical";
  if (/\b(news|filing|announce|happened|update|event)\b/.test(m)) return "news";
  if (/\b(my|position|holding|own|portfolio|p\/l|pnl|profit|loss|gain)\b/.test(m)) return "position";
  return "overview";
}

/**
 * Extract candidate symbols (2–8 letters) and keep only those that exist in the
 * universe. Case-insensitive so "mebl", "Mebl", "MEBL" all resolve.
 */
export async function resolveMessage(supabase: SupabaseClient, message: string): Promise<ResolvedMessage> {
  const candidates = [...new Set((message.toUpperCase().match(/\b[A-Z]{2,8}\b/g) ?? []).filter((w) => !STOPWORDS.has(w)))];
  let tickers: string[] = [];
  if (candidates.length) {
    const { data } = await supabase.from("stock_universe").select("ticker").in("ticker", candidates);
    const valid = new Set((data ?? []).map((r) => (r.ticker as string).toUpperCase()));
    // Preserve the order they appeared in the message.
    tickers = candidates.filter((c) => valid.has(c));
  }
  // Sector match only when no specific ticker was named (avoids misreading e.g.
  // a bank ticker as the "banks" sector).
  const sector = tickers.length === 0 ? await resolveSector(supabase, message) : null;
  return { tickers, intent: detectIntent(message), sector };
}
