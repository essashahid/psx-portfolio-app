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
