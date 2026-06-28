import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle, TechnicalSignals } from "@/lib/market/technicals";

/**
 * Compact, FREE data getters for the chat assistant — everything reads from
 * already-populated Supabase tables (no live API, no LLM). Each getter returns
 * a small typed object that doubles as (a) a "card" the UI renders directly and
 * (b) a line in the digested brief handed to Claude. Keeping these tiny is the
 * whole cost story: Claude ingests numbers, never raw documents.
 */

export interface QuoteCard {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  asOf: string | null;
}

export interface PositionCard {
  ticker: string;
  quantity: number;
  avgCost: number;
  totalCost: number;
  price: number | null;
  marketValue: number | null;
  unrealizedPL: number | null;
  unrealizedPLPct: number | null;
  dayChangePct: number | null;
}

export interface RatioCard {
  ticker: string;
  rows: { name: string; value: number | null; period: string | null }[];
  sourcePeriod: string | null;
}

export interface TechnicalCard {
  ticker: string;
  price: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  rsi: number | null;
  ma50: number | null;
  ma200: number | null;
  spark: number[] | null;
  signals: TechnicalSignals | null; // EMA21/55, EFI, divergences, Fib/ABCD, seasonality, trade plan
}

export interface DividendCard {
  ticker: string;
  ttmDps: number | null;
  recent: { raw: string; date: string | null }[];
}

export interface NewsCard {
  ticker: string | null;
  items: { title: string; type: string; date: string; url: string | null; summary?: string | null; sentiment?: string | null; source?: string | null }[];
}

export interface MarketCard {
  date: string;
  indexName: string | null;
  indexValue: number | null;
  indexChangePct: number | null;
  advancers: number;
  decliners: number;
  topSector: string | null;
  bottomSector: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function getQuoteCard(db: SupabaseClient, ticker: string): Promise<QuoteCard | null> {
  const t = ticker.toUpperCase();
  const [{ data: q }, { data: meta }] = await Promise.all([
    db.from("market_quotes").select("price, prev_close, day_change, day_change_pct, volume, market_cap, as_of").eq("ticker", t).maybeSingle(),
    db.from("stock_universe").select("company_name, sector").eq("ticker", t).maybeSingle(),
  ]);
  if (!q && !meta) return null;
  return {
    ticker: t,
    companyName: meta?.company_name ?? null,
    sector: meta?.sector ?? null,
    price: num(q?.price),
    prevClose: num(q?.prev_close),
    change: num(q?.day_change),
    changePct: num(q?.day_change_pct),
    volume: num(q?.volume),
    marketCap: num(q?.market_cap),
    asOf: q?.as_of ?? null,
  };
}

/**
 * The most recent PSX session date we hold data for (max as_of across all
 * quotes). Used to judge whether a single stock's last close is genuinely stale
 * or simply the latest session — which automatically respects weekends and
 * public holidays (Ashura, Eid, etc.), since the market has no session, and so
 * no newer as_of, on those days.
 */
export async function getLatestSessionDate(db: SupabaseClient): Promise<string | null> {
  const { data } = await db
    .from("market_quotes")
    .select("as_of")
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.as_of as string) ?? null;
}

/**
 * Daily close+volume candles for a ticker from the cached technicals bundle,
 * oldest first. Powers on-demand indicator math (any-period EMA/SMA/RSI). The
 * caller falls back to a live PSX fetch when the cache is empty.
 */
export async function getDailyCandles(db: SupabaseClient, ticker: string): Promise<Candle[]> {
  const { data } = await db
    .from("company_technicals")
    .select("data")
    .eq("ticker", ticker.toUpperCase())
    .maybeSingle();
  const hist = (data?.data as { history?: Candle[] } | null)?.history;
  return Array.isArray(hist) ? hist : [];
}

export async function getPositionCard(db: SupabaseClient, userId: string, ticker: string): Promise<PositionCard | null> {
  const t = ticker.toUpperCase();
  const { data: h } = await db
    .from("holdings")
    .select("quantity, avg_cost, total_cost")
    .eq("user_id", userId)
    .eq("ticker", t)
    .gt("quantity", 0)
    .maybeSingle();
  if (!h) return null;
  const { data: q } = await db.from("market_quotes").select("price, day_change_pct").eq("ticker", t).maybeSingle();
  const price = num(q?.price);
  const quantity = Number(h.quantity);
  const avgCost = Number(h.avg_cost);
  const totalCost = Number(h.total_cost) || quantity * avgCost;
  const marketValue = price != null ? price * quantity : null;
  const unrealizedPL = marketValue != null ? marketValue - totalCost : null;
  return {
    ticker: t,
    quantity,
    avgCost,
    totalCost,
    price,
    marketValue,
    unrealizedPL,
    unrealizedPLPct: unrealizedPL != null && totalCost > 0 ? (unrealizedPL / totalCost) * 100 : null,
    dayChangePct: num(q?.day_change_pct),
  };
}

const RATIO_ORDER = [
  "P/E", "Earnings yield", "P/B", "P/S", "EV/Sales", "EV/EBIT", "FCF yield",
  "Dividend yield (TTM)", "Payout ratio", "Dividend cover", "Book value / share",
  "Sales / share", "Cash / share", "Gross margin", "Operating margin", "Net margin",
  "ROE", "ROA", "ROIC", "Asset turnover", "Debt-to-equity", "Net debt-to-equity",
  "Debt / assets", "Liabilities / assets", "Current ratio", "Quick ratio", "Cash ratio",
  "Interest coverage", "Receivables / revenue", "Receivables / share", "Receivables % of market cap",
  "Days sales outstanding", "OCF / PAT", "Cash conversion", "Accrual ratio", "Revenue growth",
  "Profit growth", "EPS growth", "Revenue CAGR", "EPS CAGR", "Gross margin change",
  "Net margin change", "FCF margin",
];

export async function getRatioCard(db: SupabaseClient, ticker: string): Promise<RatioCard | null> {
  const t = ticker.toUpperCase();
  const { data } = await db.from("company_ratios").select("ratio_name, ratio_value, source_period").eq("ticker", t);
  if (!data || data.length === 0) return null;
  const byName = new Map(data.map((r) => [r.ratio_name as string, r]));
  const rows = RATIO_ORDER.filter((n) => byName.has(n)).map((n) => {
    const r = byName.get(n)!;
    return { name: n, value: num(r.ratio_value), period: (r.source_period as string) ?? null };
  });
  const firstWithPeriod = data.find((r) => r.source_period);
  return { ticker: t, rows, sourcePeriod: (firstWithPeriod?.source_period as string) ?? null };
}

export async function getTechnicalCard(db: SupabaseClient, ticker: string): Promise<TechnicalCard | null> {
  const t = ticker.toUpperCase();
  const { data } = await db
    .from("company_technicals")
    .select("latest_price, fifty_two_week_high, fifty_two_week_low, rsi, moving_average_50, moving_average_200, spark, data")
    .eq("ticker", t)
    .maybeSingle();
  if (!data) return null;
  const signals = (data.data as { signals?: TechnicalSignals } | null)?.signals ?? null;
  return {
    ticker: t,
    price: num(data.latest_price),
    fiftyTwoWeekHigh: num(data.fifty_two_week_high),
    fiftyTwoWeekLow: num(data.fifty_two_week_low),
    rsi: num(data.rsi),
    ma50: num(data.moving_average_50),
    ma200: num(data.moving_average_200),
    spark: Array.isArray(data.spark) ? (data.spark as number[]) : null,
    signals,
  };
}

export async function getDividendCard(db: SupabaseClient, ticker: string): Promise<DividendCard | null> {
  const t = ticker.toUpperCase();
  const { data } = await db
    .from("company_payouts")
    .select("dividend_per_share, announcement_date, raw, kind")
    .eq("ticker", t)
    .eq("kind", "cash")
    .order("announcement_date", { ascending: false })
    .limit(8);
  if (!data || data.length === 0) return null;
  const cutoff = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const ttmDps =
    data.filter((d) => d.dividend_per_share && (d.announcement_date ?? "") >= cutoff).reduce((s, d) => s + Number(d.dividend_per_share), 0) || null;
  return {
    ticker: t,
    ttmDps,
    recent: data.slice(0, 5).map((d) => ({ raw: (d.raw as string) ?? "", date: (d.announcement_date as string) ?? null })),
  };
}

export async function getNewsCard(
  db: SupabaseClient,
  userId: string,
  ticker: string | null,
  limit = 6
): Promise<NewsCard | null> {
  // Reads the user's News Center feed (news_articles) — macro/market stories,
  // holding-specific news AND official PSX filings (the psx-announcements
  // provider writes here too). Per-user and indexed, so it's fast and bounded.
  let query = db
    .from("news_articles")
    .select("title, url, source, published_at, created_at, ai_summary, snippet, sentiment, category, ticker, impact_tickers, relevance_score")
    .eq("user_id", userId)
    .eq("ignored", false)
    .eq("low_confidence", false);
  if (ticker) {
    const t = ticker.toUpperCase();
    // Direct holding news OR a market story flagged as touching this ticker.
    query = query.or(`ticker.eq.${t},impact_tickers.cs.{${t}}`);
  }
  const { data } = await query.order("published_at", { ascending: false, nullsFirst: false }).limit(limit);
  if (!data || data.length === 0) return null;
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    items: data.map((e) => ({
      title: e.title as string,
      type: (e.category as string) ?? "news",
      date: String((e.published_at as string) ?? (e.created_at as string) ?? "").slice(0, 10),
      url: (e.url as string) ?? null,
      summary: (e.ai_summary as string) ?? (typeof e.snippet === "string" ? e.snippet.slice(0, 240) : null),
      sentiment: (e.sentiment as string) ?? null,
      source: (e.source as string) ?? null,
    })),
  };
}

export async function getMarketCard(db: SupabaseClient): Promise<MarketCard | null> {
  const { data } = await db
    .from("market_snapshots")
    .select("snapshot_date, index_name, index_value, index_change_percent, total_advancers, total_decliners, top_sector, bottom_sector")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    date: data.snapshot_date as string,
    indexName: (data.index_name as string) ?? null,
    indexValue: num(data.index_value),
    indexChangePct: num(data.index_change_percent),
    advancers: data.total_advancers as number,
    decliners: data.total_decliners as number,
    topSector: (data.top_sector as string) ?? null,
    bottomSector: (data.bottom_sector as string) ?? null,
  };
}

export interface SectorCard {
  date: string;
  filter: string | null; // matched sector name when filtered to one
  sectors: {
    sector: string;
    avgReturn: number | null;
    advancers: number;
    decliners: number;
    stockCount: number;
    topGainer: string | null;
    topGainerPct: number | null;
    topLoser: string | null;
    topLoserPct: number | null;
    totalVolume: number;
  }[];
}

/**
 * Per-sector performance from the latest snapshot. Pass a query (e.g. "cement",
 * "banks") to fuzzy-match one sector; omit it for the full ranked list.
 */
export async function getSectorCard(db: SupabaseClient, sectorQuery?: string | null): Promise<SectorCard | null> {
  const { data: snap } = await db
    .from("market_snapshots")
    .select("id, snapshot_date")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap) return null;

  let q = db
    .from("sector_snapshots")
    .select("sector, average_return, advancers, decliners, stock_count, top_gainer, top_gainer_pct, top_loser, top_loser_pct, total_volume")
    .eq("snapshot_id", snap.id);
  if (sectorQuery) q = q.ilike("sector", `%${sectorQuery}%`);
  const { data } = await q;
  if (!data || data.length === 0) return null;

  const sectors = data
    .map((s) => ({
      sector: s.sector as string,
      avgReturn: num(s.average_return),
      advancers: (s.advancers as number) ?? 0,
      decliners: (s.decliners as number) ?? 0,
      stockCount: (s.stock_count as number) ?? 0,
      topGainer: (s.top_gainer as string) ?? null,
      topGainerPct: num(s.top_gainer_pct),
      topLoser: (s.top_loser as string) ?? null,
      topLoserPct: num(s.top_loser_pct),
      totalVolume: num(s.total_volume) ?? 0,
    }))
    .sort((a, b) => (b.avgReturn ?? 0) - (a.avgReturn ?? 0));

  return { date: snap.snapshot_date as string, filter: sectorQuery ?? null, sectors };
}

export interface HoldingsSummary {
  count: number;
  pricedCount: number;
  totalValue: number | null;
  totalCost: number;
  unrealizedPL: number | null;
  holdings: {
    ticker: string;
    sector: string | null;
    quantity: number;
    avgCost: number;
    marketValue: number | null;
    weightPct: number | null;
    changePct: number | null;
  }[];
  sectors: { sector: string; value: number; weightPct: number; count: number }[];
}

export async function getHoldingsSummary(db: SupabaseClient, userId: string): Promise<HoldingsSummary | null> {
  const { data: hs } = await db
    .from("holdings")
    .select("ticker, quantity, sector, avg_cost, total_cost")
    .eq("user_id", userId)
    .gt("quantity", 0);
  if (!hs || hs.length === 0) return null;

  const tickers = hs.map((h) => (h.ticker as string).toUpperCase());
  const [{ data: qs }, { data: uni }] = await Promise.all([
    db.from("market_quotes").select("ticker, price, day_change_pct").in("ticker", tickers),
    db.from("stock_universe").select("ticker, sector").in("ticker", tickers),
  ]);
  const priceMap = new Map((qs ?? []).map((q) => [(q.ticker as string).toUpperCase(), num(q.price)]));
  const chgMap = new Map((qs ?? []).map((q) => [(q.ticker as string).toUpperCase(), num(q.day_change_pct)]));
  const uniSector = new Map((uni ?? []).map((u) => [(u.ticker as string).toUpperCase(), (u.sector as string) ?? null]));

  let totalValue = 0;
  let totalCost = 0;
  let pricedCost = 0;
  let pricedCount = 0;

  const holdings = hs.map((h) => {
    const ticker = (h.ticker as string).toUpperCase();
    const quantity = Number(h.quantity);
    const avgCost = Number(h.avg_cost) || 0;
    const cost = Number(h.total_cost) || quantity * avgCost;
    totalCost += cost;
    const price = priceMap.get(ticker) ?? null;
    const marketValue = price != null ? price * quantity : null;
    if (marketValue != null) {
      totalValue += marketValue;
      pricedCost += cost;
      pricedCount++;
    }
    // Holdings.sector (from import) wins; fall back to the universe classification.
    const sector = ((h.sector as string) || uniSector.get(ticker) || null) as string | null;
    return { ticker, sector, quantity, avgCost, marketValue, changePct: chgMap.get(ticker) ?? null, cost };
  });

  const tv = totalValue > 0 ? totalValue : null;
  const withWeights = holdings.map((h) => ({
    ticker: h.ticker,
    sector: h.sector,
    quantity: h.quantity,
    avgCost: h.avgCost,
    marketValue: h.marketValue,
    weightPct: h.marketValue != null && tv ? (h.marketValue / tv) * 100 : null,
    changePct: h.changePct,
  }));

  const secMap = new Map<string, { value: number; count: number }>();
  for (const h of holdings) {
    const key = h.sector ?? "Unclassified";
    const e = secMap.get(key) ?? { value: 0, count: 0 };
    if (h.marketValue != null) e.value += h.marketValue;
    e.count++;
    secMap.set(key, e);
  }
  const sectors = [...secMap.entries()]
    .map(([sector, v]) => ({ sector, value: v.value, weightPct: tv ? (v.value / tv) * 100 : 0, count: v.count }))
    .sort((a, b) => b.value - a.value || b.count - a.count);

  return {
    count: tickers.length,
    pricedCount,
    totalValue: tv,
    totalCost,
    unrealizedPL: tv != null ? totalValue - pricedCost : null,
    holdings: withWeights,
    sectors,
  };
}
