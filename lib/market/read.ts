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
