import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshQuote } from "@/lib/engine/market-data";
import { needsRefresh } from "@/lib/market-data/psx-dps";
import type { Quote } from "@/lib/company/types";

const STALE_MINUTES = 10; // during market hours, refresh at most every 10 min

interface QuoteRow {
  ticker: string;
  price: number | null;
  prev_close: number | null;
  day_change: number | null;
  day_change_pct: number | null;
  volume: number | null;
  as_of: string | null;
  provider: string | null;
  is_realtime: boolean;
  last_fetched_at: string | null;
}

function toQuote(t: string, row: QuoteRow | null, freshness: Quote["meta"]["freshness"]): Quote {
  return {
    ticker: t,
    price: row?.price != null ? Number(row.price) : null,
    prevClose: row?.prev_close != null ? Number(row.prev_close) : null,
    dayChange: row?.day_change != null ? Number(row.day_change) : null,
    dayChangePct: row?.day_change_pct != null ? Number(row.day_change_pct) : null,
    volume: row?.volume != null ? Number(row.volume) : null,
    asOf: row?.as_of ?? null,
    meta: {
      source: row?.provider ?? null,
      lastUpdated: row?.last_fetched_at ?? null,
      freshness,
    },
  };
}

/**
 * Quote for the cockpit header: cached market_quotes row first. A missing row
 * is fetched inline (first visit needs a price); a stale row is served
 * immediately while the provider chain refreshes in the background
 * (stale-while-revalidate).
 */
export async function getQuote(supabase: SupabaseClient, ticker: string): Promise<Quote> {
  const t = ticker.toUpperCase();
  const { data: cached } = await supabase.from("market_quotes").select("*").eq("ticker", t).maybeSingle();

  if (!cached) {
    const q = await refreshQuote(t).catch(() => null);
    if (!q) return toQuote(t, null, "missing");
    return {
      ticker: t,
      price: q.price,
      prevClose: q.prevClose,
      dayChange: q.prevClose !== null ? q.price - q.prevClose : null,
      dayChangePct: q.prevClose ? ((q.price - q.prevClose) / q.prevClose) * 100 : null,
      volume: q.volume,
      asOf: q.asOf,
      meta: { source: q.provider, lastUpdated: new Date().toISOString(), freshness: "fresh" },
    };
  }

  const row = cached as QuoteRow;
  const stale = needsRefresh(row.last_fetched_at ? new Date(row.last_fetched_at) : null, STALE_MINUTES);
  if (stale) {
    // Serve the cached price now; refresh in the background for the next view.
    void refreshQuote(t).catch(() => null);
  }
  return toQuote(t, row, stale ? "stale" : "fresh");
}
