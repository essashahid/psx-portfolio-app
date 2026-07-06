import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAndIngestForeignFlows, foreignFlowsAutoConfigured } from "@/lib/market/foreign-flows-ingest";
import { bucketForSector, BUCKET_META, type SectorBucket } from "@/lib/market/sectors";

/**
 * Foreign & local investor flows read model (FIPI / LIPI).
 *
 * Reads the cached foreign_flow_* tables (fed by the scheduled fetch or a
 * manual upload — see lib/market/foreign-flows-ingest.ts) and shapes them for:
 *   - the Bulls & Bears regime overlay (net foreign buying by regime bucket),
 *   - the Market Pulse "smart money" card,
 *   - the Research Copilot get_foreign_flows tool.
 *
 * Amounts are in the reported unit (NCCPL reports FIPI/LIPI in USD millions);
 * `currency` carries that unit so the UI labels it ("$12.4M net foreign buying").
 */

export interface ForeignFlowDay {
  date: string;
  currency: string;
  fipiNet: number | null;
  fipiGrossBuy: number | null;
  fipiGrossSell: number | null;
  lipiNet: number | null;
  sourceProvider: string;
  sourceUrl: string | null;
  ingestedBy: string;
  note: string | null;
  isStale: boolean;
  ageDays: number | null;
}

export interface SectorFlow {
  sector: string;
  bucket: SectorBucket;
  net: number | null;
  grossBuy: number | null;
  grossSell: number | null;
}

export interface BucketFlow {
  bucket: SectorBucket;
  label: string;
  net: number;
  sectors: string[];
}

export interface ParticipantFlow {
  category: string;
  label: string;
  net: number | null;
}

export interface ForeignFlowSnapshot {
  day: ForeignFlowDay;
  sectors: SectorFlow[];
  buckets: BucketFlow[];
  participants: ParticipantFlow[];
  /** Net foreign buying summed across recent days (the cumulative "tide"). */
  series: { date: string; fipiNet: number | null }[];
  cumulativeNet: number | null;
  stance: "accumulating" | "distributing" | "neutral";
  stanceLabel: string;
}

export interface ForeignFlowPeriod {
  days: number;
  label: string;
  points: number;
  net: number | null;
  average: number | null;
  positiveDays: number;
  negativeDays: number;
}

export interface ForeignFlowSectorHistory {
  sector: string;
  bucket: SectorBucket;
  net: number;
  days: number;
}

export interface ForeignFlowHistory {
  days: number;
  series: { date: string; fipiNet: number | null }[];
  periods: ForeignFlowPeriod[];
  sectorTotals: ForeignFlowSectorHistory[];
}

export interface PortfolioFlowExposure {
  sector: string;
  bucket: SectorBucket;
  flowNet: number | null;
  exposureValue: number;
  portfolioWeight: number;
  tickers: string[];
  matchType: "sector" | "bucket";
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const DEFAULT_MAX_CURRENT_AGE_DAYS = 7;
const REFRESH_THROTTLE_MS = 5 * 60_000;

let lastRefreshAttempt = 0;
let refreshInFlight: Promise<void> | null = null;

function todayPk(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86400_000);
}

async function refreshBeforeCurrentRead(): Promise<void> {
  if (!foreignFlowsAutoConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const now = Date.now();
  if (now - lastRefreshAttempt < REFRESH_THROTTLE_MS) return;
  if (refreshInFlight) return refreshInFlight;

  lastRefreshAttempt = now;
  refreshInFlight = fetchAndIngestForeignFlows(createAdminClient())
    .catch(() => null)
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Aggregate per-sector foreign flow into the regime buckets the show reasons in. */
export function bucketFlows(sectors: SectorFlow[]): BucketFlow[] {
  const agg = new Map<SectorBucket, { net: number; sectors: string[] }>();
  for (const s of sectors) {
    if (s.net == null) continue;
    const a = agg.get(s.bucket) ?? { net: 0, sectors: [] };
    a.net += s.net;
    a.sectors.push(s.sector);
    agg.set(s.bucket, a);
  }
  const order: SectorBucket[] = ["energy", "cyclical", "defensive", "financials", "other"];
  return order
    .filter((b) => agg.has(b))
    .map((b) => ({ bucket: b, label: BUCKET_META[b].label, net: agg.get(b)!.net, sectors: agg.get(b)!.sectors }))
    .sort((a, b) => b.net - a.net);
}

/** Latest day with its sector / participant breakdown and a recent cumulative series. */
export async function getForeignFlowSnapshot(
  supabase: SupabaseClient,
  seriesDays = 30,
  opts: { refresh?: boolean; allowStale?: boolean; maxCurrentAgeDays?: number } = {}
): Promise<ForeignFlowSnapshot | null> {
  if (opts.refresh !== false) await refreshBeforeCurrentRead();

  const { data: latest } = await supabase
    .from("foreign_flow_days")
    .select("flow_date, currency, fipi_net, fipi_gross_buy, fipi_gross_sell, lipi_net, source_provider, source_url, ingested_by, note")
    .eq("market", "PSX")
    .order("flow_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return null;

  const flowDate = String(latest.flow_date);
  const ageDays = daysBetween(flowDate, todayPk());
  const maxAge = opts.maxCurrentAgeDays ?? DEFAULT_MAX_CURRENT_AGE_DAYS;
  const isStale = ageDays != null && ageDays > maxAge;
  if (isStale && !opts.allowStale) return null;

  const since = new Date(Date.now() - seriesDays * 86400_000).toISOString().slice(0, 10);

  const [{ data: sectorRows }, { data: partRows }, { data: seriesRows }] = await Promise.all([
    supabase
      .from("foreign_flow_sectors")
      .select("sector, net, gross_buy, gross_sell")
      .eq("market", "PSX")
      .eq("flow_date", flowDate),
    supabase
      .from("local_flow_participants")
      .select("category, label, net")
      .eq("market", "PSX")
      .eq("flow_date", flowDate),
    supabase
      .from("foreign_flow_days")
      .select("flow_date, fipi_net")
      .eq("market", "PSX")
      .gte("flow_date", since)
      .order("flow_date", { ascending: true }),
  ]);

  const sectors: SectorFlow[] = (sectorRows ?? [])
    .map((r) => ({
      sector: String(r.sector),
      bucket: bucketForSector(String(r.sector)),
      net: num(r.net),
      grossBuy: num(r.gross_buy),
      grossSell: num(r.gross_sell),
    }))
    .sort((a, b) => (b.net ?? 0) - (a.net ?? 0));

  const participants: ParticipantFlow[] = (partRows ?? [])
    .map((r) => ({ category: String(r.category), label: String(r.label ?? r.category), net: num(r.net) }))
    .sort((a, b) => Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0));

  const series = (seriesRows ?? []).map((r) => ({ date: String(r.flow_date), fipiNet: num(r.fipi_net) }));
  const cumulativeNet = series.some((s) => s.fipiNet != null)
    ? series.reduce<number>((acc, s) => acc + (s.fipiNet ?? 0), 0)
    : null;

  const day: ForeignFlowDay = {
    date: flowDate,
    currency: String(latest.currency ?? "USD"),
    fipiNet: num(latest.fipi_net),
    fipiGrossBuy: num(latest.fipi_gross_buy),
    fipiGrossSell: num(latest.fipi_gross_sell),
    lipiNet: num(latest.lipi_net),
    sourceProvider: String(latest.source_provider ?? "manual"),
    sourceUrl: latest.source_url ? String(latest.source_url) : null,
    ingestedBy: String(latest.ingested_by ?? "manual"),
    note: latest.note ? String(latest.note) : null,
    isStale,
    ageDays,
  };

  // Stance reads the recent tide, not just today, so a single noisy day doesn't flip it.
  const tide = cumulativeNet ?? day.fipiNet ?? 0;
  const stance: ForeignFlowSnapshot["stance"] = tide > 0.5 ? "accumulating" : tide < -0.5 ? "distributing" : "neutral";
  const stanceLabel =
    stance === "accumulating"
      ? "Foreigners net accumulating"
      : stance === "distributing"
        ? "Foreigners net distributing"
        : "Foreign flows roughly balanced";

  return { day, sectors, buckets: bucketFlows(sectors), participants, series, cumulativeNet, stance, stanceLabel };
}

export async function getForeignFlowHistory(
  supabase: SupabaseClient,
  days = 90
): Promise<ForeignFlowHistory> {
  const windowDays = Math.max(1, Math.min(365, days));
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString().slice(0, 10);
  const [{ data: dayRows }, { data: sectorRows }] = await Promise.all([
    supabase
      .from("foreign_flow_days")
      .select("flow_date, fipi_net")
      .eq("market", "PSX")
      .gte("flow_date", since)
      .order("flow_date", { ascending: true }),
    supabase
      .from("foreign_flow_sectors")
      .select("flow_date, sector, net")
      .eq("market", "PSX")
      .gte("flow_date", since),
  ]);

  const series = (dayRows ?? []).map((r) => ({ date: String(r.flow_date), fipiNet: num(r.fipi_net) }));
  const periods = [7, 30, 90].filter((d) => d <= windowDays).map((d) => summarizePeriod(series, d));

  const sectorAgg = new Map<string, { sector: string; bucket: SectorBucket; net: number; days: Set<string> }>();
  for (const row of sectorRows ?? []) {
    const sector = String(row.sector);
    const key = normalizeName(sector);
    const net = num(row.net);
    if (net == null) continue;
    const current = sectorAgg.get(key) ?? { sector, bucket: bucketForSector(sector), net: 0, days: new Set<string>() };
    current.net += net;
    current.days.add(String(row.flow_date));
    sectorAgg.set(key, current);
  }
  const sectorTotals = [...sectorAgg.values()]
    .map((s) => ({ sector: s.sector, bucket: s.bucket, net: s.net, days: s.days.size }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  return { days: windowDays, series, periods, sectorTotals };
}

export async function getPortfolioFlowExposure(
  supabase: SupabaseClient,
  userId: string,
  snapshot: ForeignFlowSnapshot | null
): Promise<PortfolioFlowExposure[]> {
  if (!snapshot) return [];
  const { data: holdings } = await supabase
    .from("holdings")
    .select("ticker, sector, quantity, avg_cost, total_cost")
    .eq("user_id", userId)
    .eq("hidden", false)
    .gt("quantity", 0);
  if (!holdings?.length) return [];

  const tickers = holdings.map((h) => String(h.ticker).toUpperCase());
  const { data: quotes } = await supabase
    .from("market_quotes")
    .select("ticker, price")
    .in("ticker", tickers);
  const priceByTicker = new Map((quotes ?? []).map((q) => [String(q.ticker).toUpperCase(), num(q.price)]));

  const flowBySector = new Map(snapshot.sectors.map((s) => [normalizeName(s.sector), s]));
  const flowByBucket = new Map<SectorBucket, number>();
  for (const b of snapshot.buckets) flowByBucket.set(b.bucket, b.net);

  const totalExposure = holdings.reduce((sum, h) => sum + holdingValue(h, priceByTicker.get(String(h.ticker).toUpperCase()) ?? null), 0);
  if (totalExposure <= 0) return [];

  const grouped = new Map<string, PortfolioFlowExposure>();
  for (const h of holdings) {
    const sector = String(h.sector ?? "Uncategorized");
    const bucket = bucketForSector(sector);
    const exact = flowBySector.get(normalizeName(sector));
    const matchType: PortfolioFlowExposure["matchType"] = exact ? "sector" : "bucket";
    const flowNet = exact?.net ?? flowByBucket.get(bucket) ?? null;
    const key = exact ? `sector:${normalizeName(exact.sector)}` : `bucket:${bucket}:${normalizeName(sector)}`;
    const value = holdingValue(h, priceByTicker.get(String(h.ticker).toUpperCase()) ?? null);
    const current = grouped.get(key) ?? {
      sector: exact?.sector ?? sector,
      bucket,
      flowNet,
      exposureValue: 0,
      portfolioWeight: 0,
      tickers: [],
      matchType,
    };
    current.exposureValue += value;
    current.portfolioWeight = (current.exposureValue / totalExposure) * 100;
    current.tickers.push(String(h.ticker).toUpperCase());
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .filter((x) => x.flowNet != null)
    .sort((a, b) => Math.abs(b.exposureValue) - Math.abs(a.exposureValue));
}

/** Map of regime bucket → net foreign flow, for overlaying on the Bulls & Bears rotation read. */
export async function getForeignBucketMap(supabase: SupabaseClient): Promise<Map<SectorBucket, number> | null> {
  const snap = await getForeignFlowSnapshot(supabase, 5);
  if (!snap || snap.buckets.length === 0) return null;
  return new Map(snap.buckets.map((b) => [b.bucket, b.net]));
}

/**
 * Compact card for the Research Copilot get_foreign_flows tool. Optionally
 * filters to a single sector/bucket keyword; otherwise returns the full read.
 */
export async function getForeignFlowCard(
  supabase: SupabaseClient,
  query: string | null,
  opts: { days?: number; allowStale?: boolean } = {}
): Promise<unknown | null> {
  const days = Math.max(1, Math.min(365, opts.days ?? 10));
  const snap = await getForeignFlowSnapshot(supabase, days, { allowStale: opts.allowStale });
  if (!snap) return null;
  const unit = `${snap.day.currency} mn`;
  const base = {
    date: snap.day.date,
    unit,
    freshness: snap.day.isStale ? "stale_history" : "latest_available",
    age_days: snap.day.ageDays,
    fipi_net: snap.day.fipiNet,
    fipi_gross_buy: snap.day.fipiGrossBuy,
    fipi_gross_sell: snap.day.fipiGrossSell,
    stance: snap.stanceLabel,
    cumulative_net_recent: snap.cumulativeNet,
    recent_series_days: days,
    series: snap.series,
    source: snap.day.sourceProvider,
    source_url: snap.day.sourceUrl,
  };

  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    const matched = snap.sectors.filter(
      (s) => s.sector.toLowerCase().includes(q) || s.bucket.includes(q) || BUCKET_META[s.bucket].label.toLowerCase().includes(q)
    );
    if (matched.length === 0) return { ...base, note: `No sector-level foreign flow matched "${query}" for ${snap.day.date}.` };
    return { ...base, sectors: matched.map((s) => ({ sector: s.sector, net: s.net, bucket: s.bucket })) };
  }

  return {
    ...base,
    by_bucket: snap.buckets.map((b) => ({ bucket: b.label, net: b.net })),
    top_bought: snap.sectors.filter((s) => (s.net ?? 0) > 0).slice(0, 5).map((s) => ({ sector: s.sector, net: s.net })),
    top_sold: snap.sectors.filter((s) => (s.net ?? 0) < 0).slice(-5).reverse().map((s) => ({ sector: s.sector, net: s.net })),
    local_participants: snap.participants.slice(0, 6).map((p) => ({ category: p.label, net: p.net })),
  };
}

function summarizePeriod(series: { date: string; fipiNet: number | null }[], days: number): ForeignFlowPeriod {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = series.filter((s) => s.date >= cutoff && s.fipiNet != null);
  const net = rows.length ? rows.reduce((sum, row) => sum + (row.fipiNet ?? 0), 0) : null;
  return {
    days,
    label: `${days}D`,
    points: rows.length,
    net,
    average: net != null && rows.length ? net / rows.length : null,
    positiveDays: rows.filter((r) => (r.fipiNet ?? 0) > 0).length,
    negativeDays: rows.filter((r) => (r.fipiNet ?? 0) < 0).length,
  };
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/&/g, "and").replace(/\bcompanies\b/g, "").replace(/\s+/g, " ").trim();
}

function holdingValue(
  holding: { ticker: unknown; quantity: unknown; avg_cost: unknown; total_cost: unknown },
  price: number | null
): number {
  const quantity = Number(holding.quantity ?? 0);
  if (price != null && quantity > 0) return price * quantity;
  const totalCost = Number(holding.total_cost ?? 0);
  if (totalCost > 0) return totalCost;
  return quantity * Number(holding.avg_cost ?? 0);
}
