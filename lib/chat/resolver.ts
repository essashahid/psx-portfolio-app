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
  "PSX", "BUY", "SELL", "HOLD", "ADD", "MORE", "PURCHASE", "GOOD", "BAD", "NOW", "TODAY", "WEEK", "YEAR", "PKR",
]);

export interface ResolvedMessage {
  tickers: string[];
  intent: Intent;
  sector: string | null;
  /**
   * The user is asking to explain a price move ("why did PTC rise today?").
   * Signals gatherCards to include same-session market, sector and foreign-flow
   * data even when a ticker is named, so the answer can attribute the move to
   * real evidence (sector breadth, flows, index) instead of stale web snippets.
   */
  movement: boolean;
}

const MOVE_WORDS =
  /\b(rose|rise|risen|rising|fell|fall|fallen|falling|dropp?(ed|ing)?|surg\w*|rall(y|ied|ying)|jump\w*|crash\w*|spik\w*|gain\w*|slid(e|ing)?|slump\w*|soar\w*|tank\w*|perform\w*|mov(ed?|ing|ement)|happened|up|down)\b/;

/** "Why did X rise today?" / "what moved the market" / "reason banks rose". */
function detectMovement(msg: string): boolean {
  const m = msg.toLowerCase();
  if (/\b(what|which)\s+(moved|drove|is driving|is behind|was behind)\b/.test(m)) return true;
  return /\b(why|reason|thoughts on why|explain)\b/.test(m) && MOVE_WORDS.test(m);
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
  // Explicit add/trim decision verbs win first. "Should I add X, weighing it
  // against my concentration" is a decision, not a comparison, even though it
  // contains "against" — so the decision check runs before compare, and "against"
  // is not a compare trigger (it appears far more in decision/benchmark framing).
  if (/\b(add|adding|increase|buy more|purchase more|additional purchase|average up|average down|accumulat\w*|position size|sizing|top up|add more|trim|trimming|reduce|reducing|lighten|pare)\b/.test(m)) {
    return "position";
  }
  if (/\b(compare|versus|\bvs\b|better than|compared to)\b/.test(m)) return "compare";
  if (/\b(market|index|kse|breadth|overall|sentiment|sectors?|today'?s? (market|session))\b/.test(m) && !/\bmy\b/.test(m)) return "market";
  if (/\b(dividend|payout|yield|bonus)\b/.test(m)) return "dividend";
  if (/\b(p\/e|pe ratio|valuation|cheap|expensive|overvalued|undervalued|ratio|roe|roa|margin|fundamental)\b/.test(m)) return "valuation";
  if (/\b(chart|trend|technical|52[- ]?week|rsi|moving average|support|resistance|momentum)\b/.test(m)) return "technical";
  if (/\b(news|filing|announce|happened|update|event)\b/.test(m)) return "news";
  // Portfolio / position questions — including diversification, concentration,
  // allocation and "do I have enough stocks" style questions that need the
  // user's holdings loaded, not just market data.
  if (
    /\b(my|mine|position|holding|own|owned|portfolio|p\/l|pnl|profit|loss|gain|invested|investment|diversif\w*|allocat\w*|exposure|concentrat\w*|rebalanc\w*|weighting|overweight|underweight)\b/.test(m) ||
    /\benough\s+(stocks?|shares?|holdings?|names?|positions?)\b/.test(m) ||
    /\bhow\s+many\s+(stocks?|shares?|holdings?|names?|positions?|companies)\b/.test(m)
  ) {
    return "position";
  }
  return "overview";
}

// Frequent English / finance-prose words that collide with real PSX tickers or
// appear inside many company names. They are skipped when scanning lowercase
// prose so a sentence like "analyze my cost basis and hold cash" does not query
// for COST/CASH or every company with "Company"/"Limited" in its name. This is a
// noise/perf filter only — the real safety against a coincidental match is brand
// corroboration in resolveTickers (a lowercase word is accepted as a ticker only
// when the matched company's own name backs it up).
const COMMON_PROSE = new Set([
  "cost", "cash", "news", "gain", "gains", "loss", "risk", "data", "fair", "real", "good", "best",
  "more", "less", "high", "long", "term", "company", "limited", "holding", "holdings", "portfolio",
  "stock", "stocks", "share", "shares", "price", "prices", "value", "sector", "sectors", "market",
  "today", "recent", "filing", "filings", "report", "reports", "buy", "sell", "hold", "into", "with",
  "that", "this", "from", "your", "have", "what", "when", "which", "should", "would", "could",
  "their", "based", "across", "first", "national", "general", "power", "energy", "bank",
  "industries", "international", "any", "all", "the", "and", "for", "are", "was",
  // sector/industry words — useful as a sector hint, but not a company brand.
  "cement", "sugar", "steel", "textile", "fertilizer", "chemical", "chemicals", "refinery",
  "automobile", "pharma", "leasing", "insurance", "tobacco", "glass", "paper",
]);

// Generic leading words that are not distinctive brands, so they should not pull
// in every company that happens to start with them (e.g. "Pakistan State Oil").
const GENERIC_BRAND = new Set(["the", "pakistan", "first", "national", "general", "new", "united"]);

/** First distinctive token of a company name, lowercased — its "brand" word. */
function brandWord(name: string): string | null {
  const tokens = name.toLowerCase().match(/[a-z&]{3,}/g) ?? [];
  for (const t of tokens) if (!GENERIC_BRAND.has(t)) return t;
  return null;
}

/**
 * Extract the PSX tickers the user meant. Handles three cases:
 *  1. Explicit uppercase symbols ("MEBL", "OGDC") — always trusted.
 *  2. Lowercase words that equal a ticker ("engro") — trusted only when the
 *     matched company's name backs the word up, so English words that happen to
 *     be tickers ("cost", "cash") are not mistaken for holdings.
 *  3. Company-name mentions ("lucky cement", "meezan") — matched by name, then
 *     verified by the company's leading brand word appearing in the message, so
 *     "cement" alone does not pull in every cement stock.
 */
async function resolveTickers(supabase: SupabaseClient, message: string): Promise<string[]> {
  const upperTokens = new Set((message.match(/\b[A-Z]{2,8}\b/g) ?? []).filter((w) => !STOPWORDS.has(w)));
  const words = (message.toLowerCase().match(/\b[a-z&]{2,}\b/g) ?? []).filter(
    (w) => !STOPWORDS.has(w.toUpperCase())
  );

  // Symbols to look up: explicit uppercase tokens + lowercase words short enough
  // to be a ticker, minus obvious prose words.
  const tickerCandidates = new Set<string>([
    ...upperTokens,
    ...words.filter((w) => w.length <= 8 && !COMMON_PROSE.has(w)).map((w) => w.toUpperCase()),
  ]);
  // Words distinctive enough to be a company brand (>= 4 chars, not prose).
  const nameWords = [...new Set(words.filter((w) => w.length >= 4 && !COMMON_PROSE.has(w)))].slice(0, 8);

  if (tickerCandidates.size === 0 && nameWords.length === 0) return [];

  const orParts: string[] = [];
  if (tickerCandidates.size) orParts.push(`ticker.in.(${[...tickerCandidates].slice(0, 30).join(",")})`);
  for (const w of nameWords) orParts.push(`company_name.ilike.%${w}%`);

  const { data } = await supabase
    .from("stock_universe")
    .select("ticker, company_name")
    .or(orParts.join(","))
    .limit(50);

  const rows = (data ?? []).map((r) => ({
    ticker: (r.ticker as string).toUpperCase(),
    name: ((r.company_name as string) ?? "").toLowerCase(),
  }));
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));

  const ordered: string[] = [];
  const seen = new Set<string>();
  // Once a brand is resolved (e.g. ENGRO), don't also pull its siblings
  // (EFERT, EPCL) from a bare "engro" mention.
  const claimedBrands = new Set<string>();
  const add = (ticker: string, name: string) => {
    if (seen.has(ticker)) return;
    seen.add(ticker);
    ordered.push(ticker);
    const b = brandWord(name);
    if (b) claimedBrands.add(b);
  };

  // 1. Explicit uppercase tickers — always trusted.
  for (const u of upperTokens) {
    const row = byTicker.get(u);
    if (row) add(u, row.name);
  }

  // 2. Lowercase words equal to a ticker. The candidate set already excludes
  //    prose words (COMMON_PROSE), so "ogdc"/"engro" resolve while "cost"/"cash"
  //    never reach here.
  for (const w of words) {
    const u = w.toUpperCase();
    if (upperTokens.has(u) || !tickerCandidates.has(u)) continue;
    const row = byTicker.get(u);
    if (row) add(u, row.name);
  }

  // 3. Company-name mentions ("lucky cement", "meezan") — match by the leading
  //    brand word, shortest (most specific / parent) name first, one per brand.
  const nameMatches = rows
    .filter((r) => !seen.has(r.ticker))
    .sort((a, b) => a.name.length - b.name.length);
  for (const r of nameMatches) {
    const brand = brandWord(r.name);
    if (brand && nameWords.includes(brand) && !claimedBrands.has(brand)) add(r.ticker, r.name);
  }

  return ordered.slice(0, 4);
}

export async function resolveMessage(supabase: SupabaseClient, message: string): Promise<ResolvedMessage> {
  const tickers = await resolveTickers(supabase, message);
  // Sector match only when no specific ticker was named (avoids misreading e.g.
  // a bank ticker as the "banks" sector).
  const sector = tickers.length === 0 ? await resolveSector(supabase, message) : null;
  return { tickers, intent: detectIntent(message), sector, movement: detectMovement(message) };
}
