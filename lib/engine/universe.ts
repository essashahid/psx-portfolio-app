import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPsxSymbols, classifyInstrument } from "@/lib/market-data/psx-dps";
import { invalidateStockMaster } from "@/lib/stock-master";

/**
 * Universe hygiene: one sync path shared by the manual route and the daily
 * engine cron. Three jobs, all cheap:
 *
 *  1. syncUniverseDirectory — upsert the official PSX directory with its
 *     instrument class (equity/debt/etf/right/pref/modaraba/fund) WITHOUT
 *     touching listing_status of existing rows, then mark symbols that fell
 *     out of the directory as delisted (and revive ones that came back).
 *  2. reconcileListingStatus — demote counters that exist in the directory but
 *     haven't traded in months to "suspended" so rotations skip them, and
 *     promote anything that traded today back to "active".
 *  3. activeUniverseTickers — the filtered read every rotation should use, so
 *     the daily fetch budget goes to symbols that can actually have the data.
 */

/** Instrument classes that are companies with financial statements/payouts. */
export const COMPANY_TYPES = ["equity", "modaraba"];
/** Instrument classes worth keeping quotes fresh for. */
export const QUOTABLE_TYPES = ["equity", "modaraba", "etf", "fund"];

// Consider a counter suspended when its last trade is older than this and it
// did not appear in the latest market snapshot.
const SUSPENDED_AFTER_DAYS = 60;

export interface UniverseSyncResult {
  listings: number;
  upserted: number;
  delisted: number;
  revived: number;
}

export async function syncUniverseDirectory(db: SupabaseClient): Promise<UniverseSyncResult | { error: string }> {
  const directory = await fetchPsxSymbols();
  if (directory.size === 0) return { error: "PSX symbol directory unavailable — try again shortly." };

  const now = new Date().toISOString();
  const rows = [...directory.entries()].map(([ticker, info]) => ({
    ticker,
    company_name: info.name,
    psx_name: info.name,
    sector: info.sector || null,
    exchange: "PSX",
    instrument_type: classifyInstrument(ticker, info),
    last_updated: now,
    // listing_status intentionally omitted: new rows default to "active",
    // existing rows keep their reconciled status.
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    let { error } = await db.from("stock_universe").upsert(chunk, { onConflict: "ticker" });
    if (error && /instrument_type/.test(error.message)) {
      // Migration 0030 not applied yet — sync without the column.
      const withoutType = chunk.map((r) => {
        const copy: Record<string, unknown> = { ...r };
        delete copy.instrument_type;
        return copy;
      });
      ({ error } = await db.from("stock_universe").upsert(withoutType, { onConflict: "ticker" }));
    }
    if (!error) upserted += chunk.length;
  }

  // Keep stock_master in sync for older code paths.
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400).map((r) => ({ ticker: r.ticker, company_name: r.company_name, sector: r.sector }));
    await db.from("stock_master").upsert(chunk, { onConflict: "ticker" });
  }
  invalidateStockMaster();

  // Symbols that fell out of the directory are delisted; ones that came back
  // (or are new) are active again.
  const inDirectory = new Set(directory.keys());
  const { data: all } = await db.from("stock_universe").select("ticker, listing_status").limit(5000);
  const absent = (all ?? []).filter((r) => !inDirectory.has((r.ticker as string).toUpperCase()) && r.listing_status !== "delisted").map((r) => r.ticker as string);
  const returned = (all ?? []).filter((r) => inDirectory.has((r.ticker as string).toUpperCase()) && r.listing_status === "delisted").map((r) => r.ticker as string);
  for (let i = 0; i < absent.length; i += 200) {
    await db.from("stock_universe").update({ listing_status: "delisted", last_updated: now }).in("ticker", absent.slice(i, i + 200));
  }
  for (let i = 0; i < returned.length; i += 200) {
    await db.from("stock_universe").update({ listing_status: "active", last_updated: now }).in("ticker", returned.slice(i, i + 200));
  }

  return { listings: directory.size, upserted, delisted: absent.length, revived: returned.length };
}

export interface ReconcileResult {
  suspended: number;
  promoted: number;
}

/**
 * Snapshot- and quote-driven status reconciliation. A symbol that traded in
 * the latest market snapshot is active, full stop. An "active" symbol whose
 * last known trade (market_quotes.as_of) is older than SUSPENDED_AFTER_DAYS —
 * or that has no quote at all — and that did not trade today is suspended, so
 * the rotations stop burning fetch slots on it. Suspension is fully
 * reversible: the next trade promotes it back.
 */
export async function reconcileListingStatus(db: SupabaseClient): Promise<ReconcileResult> {
  const now = new Date().toISOString();

  const { data: snap } = await db
    .from("market_snapshots")
    .select("id")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const traded = new Set<string>();
  if (snap?.id) {
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from("market_snapshot_items").select("ticker").eq("snapshot_id", snap.id).range(from, from + 999);
      for (const r of data ?? []) traded.add((r.ticker as string).toUpperCase());
      if (!data || data.length < 1000) break;
    }
  }
  if (traded.size === 0) return { suspended: 0, promoted: 0 }; // no snapshot yet — don't guess

  const { data: universe } = await db.from("stock_universe").select("ticker, listing_status").neq("listing_status", "delisted").limit(5000);
  const { data: quotes } = await db.from("market_quotes").select("ticker, as_of").limit(5000);
  const lastTrade = new Map((quotes ?? []).map((q) => [(q.ticker as string).toUpperCase(), (q.as_of as string) ?? ""]));

  const cutoff = new Date(Date.now() - SUSPENDED_AFTER_DAYS * 86400_000).toISOString().slice(0, 10);
  const toSuspend: string[] = [];
  const toPromote: string[] = [];
  for (const row of universe ?? []) {
    const t = (row.ticker as string).toUpperCase();
    if (traded.has(t)) {
      if (row.listing_status !== "active") toPromote.push(t);
      continue;
    }
    if (row.listing_status !== "active") continue;
    const asOf = lastTrade.get(t);
    if (!asOf || asOf < cutoff) toSuspend.push(t);
  }

  for (let i = 0; i < toSuspend.length; i += 200) {
    await db.from("stock_universe").update({ listing_status: "suspended", last_updated: now }).in("ticker", toSuspend.slice(i, i + 200));
  }
  for (let i = 0; i < toPromote.length; i += 200) {
    await db.from("stock_universe").update({ listing_status: "active", last_updated: now }).in("ticker", toPromote.slice(i, i + 200));
  }
  return { suspended: toSuspend.length, promoted: toPromote.length };
}

/**
 * Active universe tickers filtered to instrument classes that can actually
 * have the requested data. Falls back to the unfiltered active set when the
 * instrument_type column doesn't exist yet (migration 0030 pending).
 */
export async function activeUniverseTickers(db: SupabaseClient, kind: "companies" | "quotable"): Promise<string[]> {
  const types = kind === "companies" ? COMPANY_TYPES : QUOTABLE_TYPES;
  const filtered = await db
    .from("stock_universe")
    .select("ticker")
    .eq("listing_status", "active")
    .in("instrument_type", types)
    .limit(3000);
  if (!filtered.error) return (filtered.data ?? []).map((r) => (r.ticker as string).toUpperCase());
  const { data } = await db.from("stock_universe").select("ticker").eq("listing_status", "active").limit(3000);
  return (data ?? []).map((r) => (r.ticker as string).toUpperCase());
}
