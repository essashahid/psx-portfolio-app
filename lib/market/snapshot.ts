import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPsxSymbols } from "@/lib/market-data/psx-dps";
import { fetchMarketWatch, fetchIndices, headlineIndex, type MarketWatchRow } from "@/lib/market/psx-market-watch";

/**
 * Market Pulse snapshot builder.
 *
 * Pulls the whole market in two HTTP requests (market-watch + indices), joins
 * the official sector directory for readable sector names and cached technicals
 * for 52-week ranges + average volume, then derives breadth, per-sector
 * aggregates, and ranked mover lists. Everything is persisted to the market_*
 * tables so the page reads cached data only. No per-ticker calls, no LLM.
 */

const NEAR_RANGE_PCT = 3; // within 3% of 52-week high/low
const UNUSUAL_VOLUME_MULTIPLE = 2; // volume ≥ 2× average
const MOVER_LIMIT = 15;
const MIN_VOLUME_FOR_MOVER = 1; // ignore untraded rows in % movers

export interface BuildResult {
  snapshotId: string | null;
  date: string;
  items: number;
  advancers: number;
  decliners: number;
  index: string | null;
  errors: string[];
}

interface EnrichedItem extends MarketWatchRow {
  sector: string | null;
  valueTraded: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  nearHigh: boolean;
  nearLow: boolean;
  unusualVolume: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pktDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

/**
 * Build today's snapshot and persist it. Returns a summary; on a total feed
 * failure it records nothing and reports the error so the caller/UI can show a
 * clear unavailable state.
 */
export async function buildMarketSnapshot(client?: SupabaseClient): Promise<BuildResult> {
  const db = client ?? createAdminClient();
  const date = pktDate();
  const errors: string[] = [];

  const [watch, indices, directory] = await Promise.all([
    fetchMarketWatch(),
    fetchIndices().catch(() => []),
    fetchPsxSymbols().catch(() => new Map()),
  ]);

  if (watch.length === 0) {
    return { snapshotId: null, date, items: 0, advancers: 0, decliners: 0, index: null, errors: ["PSX market-watch feed returned no rows."] };
  }

  // Cached technicals (52w range + average volume) for the traded set.
  const tickers = watch.map((r) => r.ticker);
  const techByTicker = new Map<string, { high: number | null; low: number | null; avgVol: number | null }>();
  const capByTicker = new Map<string, number | null>();
  for (let i = 0; i < tickers.length; i += 500) {
    const chunk = tickers.slice(i, i + 500);
    const [{ data: tech }, { data: meta }] = await Promise.all([
      db.from("company_technicals").select("ticker, fifty_two_week_high, fifty_two_week_low, average_volume").in("ticker", chunk),
      db.from("company_metadata").select("ticker, market_cap").in("ticker", chunk),
    ]);
    for (const t of tech ?? []) techByTicker.set(t.ticker, { high: t.fifty_two_week_high, low: t.fifty_two_week_low, avgVol: t.average_volume });
    for (const m of meta ?? []) capByTicker.set(m.ticker, m.market_cap);
  }

  // Enrich every row with sector, value traded, 52w flags, unusual volume.
  const items: EnrichedItem[] = watch.map((r) => {
    const dir = directory.get(r.ticker);
    const tech = techByTicker.get(r.ticker);
    const valueTraded = r.volume != null && r.price != null ? r.volume * r.price : null;
    const high = tech?.high ?? null;
    const low = tech?.low ?? null;
    const price = r.price;
    const nearHigh = !!(price && high && high > 0 && (high - price) / high <= NEAR_RANGE_PCT / 100 && price <= high * 1.001);
    const nearLow = !!(price && low && low > 0 && (price - low) / low <= NEAR_RANGE_PCT / 100 && price >= low * 0.999);
    const unusualVolume = !!(r.volume && tech?.avgVol && tech.avgVol > 0 && r.volume >= tech.avgVol * UNUSUAL_VOLUME_MULTIPLE);
    return {
      ...r,
      companyName: r.companyName ?? dir?.name ?? null,
      sector: dir?.sector || null,
      valueTraded,
      marketCap: capByTicker.get(r.ticker) ?? null,
      fiftyTwoWeekHigh: high,
      fiftyTwoWeekLow: low,
      nearHigh,
      nearLow,
      unusualVolume,
    };
  });

  // Breadth + totals.
  let advancers = 0, decliners = 0, unchanged = 0, totalVolume = 0, totalValue = 0;
  for (const it of items) {
    const c = it.changePercent ?? 0;
    if (c > 0) advancers++;
    else if (c < 0) decliners++;
    else unchanged++;
    totalVolume += it.volume ?? 0;
    totalValue += it.valueTraded ?? 0;
  }
  const mostActive = [...items].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0];

  // Per-sector aggregates.
  const bySector = new Map<string, EnrichedItem[]>();
  for (const it of items) {
    const key = it.sector || "Unclassified";
    (bySector.get(key) ?? bySector.set(key, []).get(key)!).push(it);
  }
  const sectorRows = [...bySector.entries()].map(([sector, list]) => {
    const returns = list.map((i) => i.changePercent).filter((v): v is number => v != null);
    const avg = returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : null;
    const sorted = [...list].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
    const gainer = sorted[0];
    const loser = sorted[sorted.length - 1];
    return {
      sector,
      average_return: avg,
      median_return: median(returns),
      total_volume: list.reduce((s, i) => s + (i.volume ?? 0), 0),
      total_value: list.reduce((s, i) => s + (i.valueTraded ?? 0), 0),
      advancers: list.filter((i) => (i.changePercent ?? 0) > 0).length,
      decliners: list.filter((i) => (i.changePercent ?? 0) < 0).length,
      unchanged: list.filter((i) => (i.changePercent ?? 0) === 0).length,
      stock_count: list.length,
      top_gainer: gainer?.changePercent != null ? gainer.ticker : null,
      top_gainer_pct: gainer?.changePercent ?? null,
      top_loser: loser?.changePercent != null ? loser.ticker : null,
      top_loser_pct: loser?.changePercent ?? null,
    };
  });
  const rankedSectors = sectorRows
    .filter((s) => s.stock_count >= 2 && s.average_return != null)
    .sort((a, b) => (b.average_return ?? 0) - (a.average_return ?? 0));
  const topSector = rankedSectors[0]?.sector ?? null;
  const bottomSector = rankedSectors[rankedSectors.length - 1]?.sector ?? null;

  // Index.
  const idx = headlineIndex(indices);

  // Persist snapshot (upsert by date so re-runs replace cleanly).
  const { data: snap, error: snapErr } = await db
    .from("market_snapshots")
    .upsert(
      {
        market: "PSX",
        snapshot_date: date,
        snapshot_time: new Date().toISOString(),
        index_name: idx?.name ?? null,
        index_value: idx?.value ?? null,
        index_change: idx?.change ?? null,
        index_change_percent: idx?.changePercent ?? null,
        total_advancers: advancers,
        total_decliners: decliners,
        total_unchanged: unchanged,
        total_volume: totalVolume,
        total_value: totalValue,
        most_active_ticker: mostActive?.ticker ?? null,
        top_sector: topSector,
        bottom_sector: bottomSector,
        source_provider: "psx-dps",
        freshness: "fresh",
        item_count: items.length,
      },
      { onConflict: "market,snapshot_date" }
    )
    .select("id")
    .single();

  if (snapErr || !snap) {
    return { snapshotId: null, date, items: items.length, advancers, decliners, index: idx?.name ?? null, errors: [`snapshot upsert: ${snapErr?.message ?? "no row"}`] };
  }
  const snapshotId = snap.id as string;

  // Replace children for this snapshot.
  await Promise.all([
    db.from("market_snapshot_items").delete().eq("snapshot_id", snapshotId),
    db.from("sector_snapshots").delete().eq("snapshot_id", snapshotId),
    db.from("market_movers").delete().eq("snapshot_id", snapshotId),
  ]);

  // Items (chunked insert).
  const itemRows = items.map((it) => ({
    snapshot_id: snapshotId,
    ticker: it.ticker,
    company_name: it.companyName,
    sector: it.sector,
    price: it.price,
    previous_close: it.previousClose,
    change: it.change,
    change_percent: it.changePercent,
    open: it.open,
    high: it.high,
    low: it.low,
    volume: it.volume,
    value_traded: it.valueTraded,
    market_cap: it.marketCap,
    fifty_two_week_high: it.fiftyTwoWeekHigh,
    fifty_two_week_low: it.fiftyTwoWeekLow,
    near_high: it.nearHigh,
    near_low: it.nearLow,
    unusual_volume: it.unusualVolume,
    source_provider: "psx-dps",
  }));
  for (let i = 0; i < itemRows.length; i += 400) {
    const { error } = await db.from("market_snapshot_items").insert(itemRows.slice(i, i + 400));
    if (error) errors.push(`items: ${error.message}`);
  }

  // Sectors.
  if (sectorRows.length) {
    const { error } = await db.from("sector_snapshots").insert(sectorRows.map((s) => ({ snapshot_id: snapshotId, ...s })));
    if (error) errors.push(`sectors: ${error.message}`);
  }

  // Movers.
  const moverRows = buildMovers(snapshotId, items);
  for (let i = 0; i < moverRows.length; i += 400) {
    const { error } = await db.from("market_movers").insert(moverRows.slice(i, i + 400));
    if (error) errors.push(`movers: ${error.message}`);
  }

  // Mirror quotes into market_quotes so the rest of the app benefits from the
  // same fresh whole-market pull (cache-first quote service, search, cockpit).
  await mirrorQuotes(db, items, date).catch((e) => errors.push(`mirror: ${e instanceof Error ? e.message : e}`));

  // Observability.
  await db.from("data_fetch_logs").insert({
    ticker: null,
    section: "market_snapshot",
    source: "psx-market-watch+indices",
    status: errors.length ? "error" : "ok",
    rows: items.length,
    detail: errors.join("; ").slice(0, 300) || `${advancers}↑ ${decliners}↓ · ${idx?.name ?? "no index"}`,
  }).then(() => {}, () => {});

  return { snapshotId, date, items: items.length, advancers, decliners, index: idx?.name ?? null, errors };
}

function buildMovers(snapshotId: string, items: EnrichedItem[]) {
  const rows: Record<string, unknown>[] = [];
  const push = (category: string, list: EnrichedItem[]) =>
    list.slice(0, MOVER_LIMIT).forEach((it, i) =>
      rows.push({
        snapshot_id: snapshotId,
        category,
        ticker: it.ticker,
        company_name: it.companyName,
        sector: it.sector,
        price: it.price,
        change_percent: it.changePercent,
        volume: it.volume,
        value_traded: it.valueTraded,
        rank: i + 1,
      })
    );

  const traded = items.filter((i) => (i.volume ?? 0) >= MIN_VOLUME_FOR_MOVER);
  push("gainers", [...traded].filter((i) => (i.changePercent ?? 0) > 0).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)));
  push("losers", [...traded].filter((i) => (i.changePercent ?? 0) < 0).sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)));
  push("active_volume", [...items].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
  push("active_value", [...items].sort((a, b) => (b.valueTraded ?? 0) - (a.valueTraded ?? 0)));
  push("unusual_volume", [...items].filter((i) => i.unusualVolume).sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
  push("near_high", [...items].filter((i) => i.nearHigh).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0)));
  push("near_low", [...items].filter((i) => i.nearLow).sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0)));
  return rows;
}

async function mirrorQuotes(db: SupabaseClient, items: EnrichedItem[], date: string): Promise<void> {
  const rows = items
    .filter((i) => i.price != null)
    .map((i) => ({
      ticker: i.ticker,
      price: i.price,
      prev_close: i.previousClose,
      day_change: i.change,
      day_change_pct: i.changePercent,
      open: i.open,
      high: i.high,
      low: i.low,
      volume: i.volume,
      market_cap: i.marketCap,
      as_of: date,
      provider: "psx-dps",
      provider_symbol: i.ticker,
      is_realtime: false,
      last_fetched_at: new Date().toISOString(),
    }));
  for (let i = 0; i < rows.length; i += 400) {
    await db.from("market_quotes").upsert(rows.slice(i, i + 400), { onConflict: "ticker" });
  }
}
