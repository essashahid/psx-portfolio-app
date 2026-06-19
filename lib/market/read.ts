import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read model for the Market Pulse page. Everything the page renders comes from
 * the cached market_* tables in a single batched read — no live calls on load.
 * Ownership/watchlist sets are resolved here so badges and the personal
 * "holdings vs market" section can be computed without extra round-trips.
 */

export interface SnapshotRow {
  id: string;
  snapshot_date: string;
  snapshot_time: string;
  index_name: string | null;
  index_value: number | null;
  index_change: number | null;
  index_change_percent: number | null;
  total_advancers: number;
  total_decliners: number;
  total_unchanged: number;
  total_volume: number;
  total_value: number;
  most_active_ticker: string | null;
  top_sector: string | null;
  bottom_sector: string | null;
  source_provider: string;
  freshness: string;
  item_count: number;
}

export interface SectorRow {
  sector: string;
  average_return: number | null;
  median_return: number | null;
  total_volume: number;
  total_value: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  stock_count: number;
  top_gainer: string | null;
  top_gainer_pct: number | null;
  top_loser: string | null;
  top_loser_pct: number | null;
}

export interface MoverRow {
  category: string;
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_percent: number | null;
  volume: number | null;
  value_traded: number | null;
  rank: number;
}

export interface ItemRow {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_percent: number | null;
  volume: number | null;
  value_traded: number | null;
  market_cap: number | null;
  near_high: boolean;
  near_low: boolean;
  unusual_volume: boolean;
}

export interface EventRow {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  event_type: string;
  title: string;
  source_url: string | null;
  source_quality: string;
  event_date: string;
  event_time: string | null;
}

export interface OwnedPerf {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  change_percent: number | null;
  price: number | null;
  vsSector: number | null; // stock return − sector avg return
}

export interface MarketDashboard {
  snapshot: SnapshotRow | null;
  sectors: SectorRow[];
  movers: Record<string, MoverRow[]>;
  heatmap: ItemRow[];
  events: EventRow[];
  brief: { title: string | null; content: string; created_at: string; model: string | null } | null;
  ownedTickers: Set<string>;
  watchTickers: Set<string>;
  owned: OwnedPerf[];
  updatedLabel: string | null;
}

export interface FreshnessItem {
  key: "market" | "prices" | "foreign_flows" | "news" | "dividends" | "brief";
  label: string;
  date: string | null;
  detail: string | null;
  ageDays: number | null;
  status: "fresh" | "watch" | "stale" | "missing";
  refresh: { endpoint: string; body?: Record<string, unknown>; label: string } | null;
}

const HEATMAP_LIMIT = 150;

export async function getMarketDashboard(supabase: SupabaseClient, userId: string): Promise<MarketDashboard> {
  const { data: snap } = await supabase
    .from("market_snapshots")
    .select("*")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const snapshot = (snap ?? null) as SnapshotRow | null;

  // Ownership + watchlist always resolve (needed even with no snapshot).
  const [{ data: holdings }, { data: watch }] = await Promise.all([
    supabase.from("holdings").select("ticker, company_name, sector, quantity").eq("user_id", userId),
    supabase.from("stock_watchlist").select("ticker").eq("user_id", userId),
  ]);
  const ownedTickers = new Set((holdings ?? []).filter((h) => Number(h.quantity) > 0).map((h) => (h.ticker as string).toUpperCase()));
  const watchTickers = new Set((watch ?? []).map((w) => (w.ticker as string).toUpperCase()));

  if (!snapshot) {
    return { snapshot: null, sectors: [], movers: {}, heatmap: [], events: [], brief: null, ownedTickers, watchTickers, owned: [], updatedLabel: null };
  }

  const [{ data: sectors }, { data: movers }, { data: items }, { data: events }, { data: brief }, { data: latestFlow }] = await Promise.all([
    supabase.from("sector_snapshots").select("*").eq("snapshot_id", snapshot.id).order("average_return", { ascending: false }),
    supabase.from("market_movers").select("category, ticker, company_name, sector, price, change_percent, volume, value_traded, rank").eq("snapshot_id", snapshot.id).order("rank"),
    supabase.from("market_snapshot_items").select("ticker, company_name, sector, price, change_percent, volume, value_traded, market_cap, near_high, near_low, unusual_volume").eq("snapshot_id", snapshot.id).order("value_traded", { ascending: false, nullsFirst: false }).limit(HEATMAP_LIMIT),
    supabase.from("market_events").select("ticker, company_name, sector, event_type, title, source_url, source_quality, event_date, event_time").eq("event_date", snapshot.snapshot_date).order("event_time", { ascending: false }),
    supabase.from("market_ai_briefs").select("title, content, created_at, model, structured_output").eq("snapshot_date", snapshot.snapshot_date).maybeSingle(),
    supabase.from("foreign_flow_days").select("flow_date").eq("market", "PSX").order("flow_date", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const moversByCat: Record<string, MoverRow[]> = {};
  for (const m of (movers ?? []) as MoverRow[]) (moversByCat[m.category] ??= []).push(m);

  // Personal: owned stocks present in today's snapshot, with sector-relative perf.
  const sectorAvg = new Map((sectors ?? []).map((s) => [s.sector, s.average_return]));
  const ownedRows: OwnedPerf[] = [];
  if (ownedTickers.size) {
    const { data: ownedItems } = await supabase
      .from("market_snapshot_items")
      .select("ticker, company_name, sector, price, change_percent")
      .eq("snapshot_id", snapshot.id)
      .in("ticker", [...ownedTickers]);
    for (const it of ownedItems ?? []) {
      const secAvg = it.sector ? (sectorAvg.get(it.sector) ?? null) : null;
      ownedRows.push({
        ticker: it.ticker,
        company_name: it.company_name,
        sector: it.sector,
        change_percent: it.change_percent,
        price: it.price,
        vsSector: it.change_percent != null && secAvg != null ? it.change_percent - secAvg : null,
      });
    }
    ownedRows.sort((a, b) => (b.change_percent ?? 0) - (a.change_percent ?? 0));
  }

  const updatedLabel = snapshot.snapshot_time ? new Date(snapshot.snapshot_time).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }) : null;

  return {
    snapshot,
    sectors: (sectors ?? []) as SectorRow[],
    movers: moversByCat,
    heatmap: (items ?? []) as ItemRow[],
    events: (events ?? []) as EventRow[],
    brief: brief && briefMatchesLatestFlow(brief.structured_output, latestFlow?.flow_date ? String(latestFlow.flow_date) : null)
      ? { title: brief.title, content: brief.content, created_at: brief.created_at, model: brief.model }
      : null,
    ownedTickers,
    watchTickers,
    owned: ownedRows,
    updatedLabel,
  };
}

export async function getDataFreshness(supabase: SupabaseClient, userId: string): Promise<FreshnessItem[]> {
  const [
    { data: market },
    { data: price },
    { data: flow },
    { data: news },
    { data: dividend },
    { data: brief },
  ] = await Promise.all([
    supabase
      .from("market_snapshots")
      .select("snapshot_date, snapshot_time, source_provider")
      .eq("market", "PSX")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("prices")
      .select("price_date, source, created_at")
      .eq("user_id", userId)
      .order("price_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("foreign_flow_days")
      .select("flow_date, source_provider, updated_at")
      .eq("market", "PSX")
      .order("flow_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("news_articles")
      .select("created_at, source")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("dividends")
      .select("created_at, source")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("market_ai_briefs")
      .select("snapshot_date, created_at, model")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return [
    freshnessItem({
      key: "market",
      label: "Market snapshot",
      date: market?.snapshot_date ? String(market.snapshot_date) : null,
      detail: market?.source_provider ? String(market.source_provider) : null,
      freshDays: 1,
      staleDays: 3,
      refresh: { endpoint: "/api/market/refresh", body: { section: "all" }, label: "Refresh market" },
    }),
    freshnessItem({
      key: "foreign_flows",
      label: "Foreign flows",
      date: flow?.flow_date ? String(flow.flow_date) : null,
      detail: flow?.source_provider ? String(flow.source_provider) : null,
      freshDays: 2,
      staleDays: 7,
      refresh: { endpoint: "/api/flows/refresh", label: "Refresh flows" },
    }),
    freshnessItem({
      key: "prices",
      label: "Portfolio prices",
      date: price?.price_date ? String(price.price_date) : null,
      detail: price?.source ? String(price.source) : null,
      freshDays: 2,
      staleDays: 7,
      refresh: { endpoint: "/api/prices", body: { refresh: true }, label: "Refresh prices" },
    }),
    freshnessItem({
      key: "news",
      label: "Holding news",
      date: news?.created_at ? String(news.created_at).slice(0, 10) : null,
      detail: news?.source ? String(news.source) : null,
      freshDays: 3,
      staleDays: 10,
      refresh: { endpoint: "/api/news/refresh", label: "Refresh news" },
    }),
    freshnessItem({
      key: "dividends",
      label: "Dividends",
      date: dividend?.created_at ? String(dividend.created_at).slice(0, 10) : null,
      detail: dividend?.source ? String(dividend.source) : null,
      freshDays: 7,
      staleDays: 30,
      refresh: { endpoint: "/api/dividends/daily", label: "Daily update" },
    }),
    freshnessItem({
      key: "brief",
      label: "AI market brief",
      date: brief?.snapshot_date ? String(brief.snapshot_date) : null,
      detail: brief?.model ? String(brief.model) : null,
      freshDays: 1,
      staleDays: 3,
      refresh: { endpoint: "/api/market/refresh", body: { section: "brief" }, label: "Regenerate" },
    }),
  ];
}

function briefMatchesLatestFlow(structured: unknown, latestFlowDate: string | null): boolean {
  if (!latestFlowDate) return true;
  if (isStaleFlowDate(latestFlowDate)) return false;
  if (!structured || typeof structured !== "object") return false;
  return (structured as Record<string, unknown>).foreignFlowDate === latestFlowDate;
}

function isStaleFlowDate(flowDate: string): boolean {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const a = Date.parse(`${flowDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.floor((b - a) / 86400_000) > 7;
}

function freshnessItem(input: {
  key: FreshnessItem["key"];
  label: string;
  date: string | null;
  detail: string | null;
  freshDays: number;
  staleDays: number;
  refresh: FreshnessItem["refresh"];
}): FreshnessItem {
  const ageDays = input.date ? ageInDays(input.date) : null;
  const status: FreshnessItem["status"] =
    ageDays == null
      ? "missing"
      : ageDays <= input.freshDays
        ? "fresh"
        : ageDays <= input.staleDays
          ? "watch"
          : "stale";
  return { key: input.key, label: input.label, date: input.date, detail: input.detail, ageDays, status, refresh: input.refresh };
}

function ageInDays(date: string): number | null {
  const day = date.slice(0, 10);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400_000));
}
