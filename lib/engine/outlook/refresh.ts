import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMarketWatch } from "@/lib/market/psx-market-watch";
import { PSX_PRICE_SOURCE } from "@/lib/market-data/psx-dps";
import { computeBreadth, type PricePanel } from "@/lib/engine/outlook/breadth";

/**
 * Daily refresh for the Market Outlook.
 *
 * Breadth is derived from every constituent's close, so it only stays current
 * if every constituent's close is stored every session. The one-off backfill
 * that created the history did that with 654 individual requests, which is far
 * too slow for a cron; this uses the market-watch endpoint, which returns the
 * whole market in a single call, and appends one row per symbol per session.
 *
 * Breadth is then recomputed over a trailing window rather than the full five
 * years. The 200-day average needs 200 sessions of context, so the panel is
 * loaded back that far, but only recent days are rewritten. That keeps a daily
 * run inside the cron timeout while producing identical values, because the
 * computation is deterministic and depends only on prior closes.
 */

/** Sessions of panel history loaded. Comfortably covers the 200-day average. */
const PANEL_LOOKBACK_SESSIONS = 320;
/** Trailing days of breadth rewritten each run, so a missed run self-heals. */
const RECOMPUTE_DAYS = 15;

const INDEX_SYMBOLS = new Set(["KSE100", "KSE30", "KMI30", "ALLSHR"]);

export interface OutlookRefreshResult {
  tradeDate: string | null;
  pricesWritten: number;
  breadthDaysWritten: number;
  skipped: string | null;
}

/** Latest trade date already stored for the index. */
async function latestIndexDate(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("company_price_history")
    .select("price_date")
    .eq("ticker", "KSE100")
    .order("price_date", { ascending: false })
    .limit(1);
  return (data?.[0]?.price_date as string | undefined) ?? null;
}

/**
 * Append today's close for every traded symbol.
 *
 * Market watch reports the live or last-traded price, so this is only written
 * once the session has closed. The caller schedules it accordingly; writing
 * mid-session would store an intraday price as if it were a close.
 */
export async function captureDailyCloses(admin: SupabaseClient, tradeDate: string): Promise<number> {
  const rows = await fetchMarketWatch();
  const now = new Date().toISOString();

  const payload = rows
    .filter((r) => r.ticker && typeof r.price === "number" && Number.isFinite(r.price) && r.price > 0)
    .map((r) => ({
      ticker: r.ticker,
      price_date: tradeDate,
      close: r.price as number,
      volume: typeof r.volume === "number" && r.volume > 0 ? r.volume : null,
      source: PSX_PRICE_SOURCE,
      updated_at: now,
    }));

  // One row per ticker: a duplicate symbol in the feed would make Postgres
  // reject the whole batch.
  const byTicker = new Map(payload.map((p) => [p.ticker, p]));
  const unique = [...byTicker.values()];

  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { error } = await admin
      .from("company_price_history")
      .upsert(unique.slice(i, i + CHUNK), { onConflict: "ticker,price_date" });
    if (error) throw error;
    written += Math.min(CHUNK, unique.length - i);
  }
  return written;
}

/** Load a trailing slice of the constituent panel. */
async function loadRecentPanel(admin: SupabaseClient, fromDate: string): Promise<PricePanel> {
  const PAGE = 1000;
  const panel: PricePanel = new Map();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("company_price_history")
      .select("ticker, price_date, close, volume")
      .gte("price_date", fromDate)
      .order("ticker", { ascending: true })
      .order("price_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const ticker = r.ticker as string;
      if (INDEX_SYMBOLS.has(ticker)) continue;
      const close = Number(r.close);
      if (!Number.isFinite(close) || close <= 0) continue;
      const list = panel.get(ticker) ?? [];
      list.push({ date: r.price_date as string, close, volume: r.volume === null ? null : Number(r.volume) });
      panel.set(ticker, list);
    }
    if (rows.length < PAGE) break;
  }
  return panel;
}

/** Index trading days at or after a date, oldest first. */
async function tradingDaysFrom(admin: SupabaseClient, fromDate: string): Promise<string[]> {
  const PAGE = 1000;
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("company_price_history")
      .select("price_date")
      .eq("ticker", "KSE100")
      .gte("price_date", fromDate)
      .order("price_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows.map((r) => r.price_date as string));
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Recompute and store breadth for the trailing window. */
export async function refreshRecentBreadth(admin: SupabaseClient): Promise<number> {
  const allDays = await tradingDaysFrom(admin, "1900-01-01");
  if (allDays.length === 0) return 0;

  const panelStart = allDays[Math.max(0, allDays.length - PANEL_LOOKBACK_SESSIONS)];
  const recomputeFrom = allDays[Math.max(0, allDays.length - RECOMPUTE_DAYS)];

  const panel = await loadRecentPanel(admin, panelStart);
  const targetDays = allDays.filter((d) => d >= recomputeFrom);
  const breadth = computeBreadth(panel, targetDays);
  if (breadth.length === 0) return 0;

  const now = new Date().toISOString();
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < breadth.length; i += CHUNK) {
    const chunk = breadth.slice(i, i + CHUNK).map((d) => ({ ...d, computed_at: now }));
    const { error } = await admin.from("market_breadth_history").upsert(chunk, { onConflict: "trade_date" });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

/**
 * Full daily refresh. Capturing closes is skipped when the index has no new
 * session yet, so a run on a holiday or before the close does not overwrite the
 * previous session with a stale or intraday price.
 */
export async function refreshOutlookData(admin: SupabaseClient, opts: { force?: boolean } = {}): Promise<OutlookRefreshResult> {
  const indexDate = await latestIndexDate(admin);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });

  let pricesWritten = 0;
  let skipped: string | null = null;

  if (opts.force || indexDate === today) {
    // The index already has today's close, so the session is done and the
    // market-watch prices are final.
    pricesWritten = await captureDailyCloses(admin, opts.force && indexDate !== today ? (indexDate ?? today) : today);
  } else {
    skipped = `Index has no close for ${today} yet (latest ${indexDate ?? "none"}); constituent capture skipped.`;
  }

  const breadthDaysWritten = await refreshRecentBreadth(admin);
  return { tradeDate: indexDate, pricesWritten, breadthDaysWritten, skipped };
}
