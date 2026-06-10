import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketDataProvider, PricePoint } from "@/lib/market-data/adapter";

/**
 * Live prices from the official PSX Data Portal (dps.psx.com.pk).
 *
 * Endpoints (no key required):
 *   /timeseries/int/{SYMBOL} — intraday ticks, newest first: [unixSec, price, volume]
 *   /timeseries/eod/{SYMBOL} — daily closes, newest first: [unixSec, close, volume, ...]
 *
 * The portal sits behind a WAF that rejects non-browser requests, so we send
 * browser headers. Requests are batched to stay under its rate limits.
 */

const DPS_BASE = "https://dps.psx.com.pk/timeseries";
const BATCH_SIZE = 5;
const REQUEST_TIMEOUT_MS = 8000;
export const PSX_PRICE_SOURCE = "psx-dps";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://dps.psx.com.pk/",
};

type SeriesRow = [number, number, ...number[]]; // [unixSec, price, ...]

async function fetchSeries(kind: "int" | "eod", ticker: string): Promise<SeriesRow[] | null> {
  try {
    const res = await fetch(`${DPS_BASE}/${kind}/${encodeURIComponent(ticker)}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { status?: number; data?: SeriesRow[] };
    if (json.status !== 1 || !Array.isArray(json.data) || json.data.length === 0) return null;
    return json.data;
  } catch {
    return null;
  }
}

/** Trade date in Pakistan time for a unix-seconds timestamp. */
function pktDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
}

function latestFromSeries(ticker: string, rows: SeriesRow[]): PricePoint | null {
  const row = rows.find((r) => Number.isFinite(r[1]) && r[1] > 0);
  if (!row) return null;
  return { ticker, price: row[1], date: pktDate(row[0]), source: PSX_PRICE_SOURCE };
}

export class PsxDpsProvider implements MarketDataProvider {
  readonly name = "psx";
  constructor(private supabase: SupabaseClient, private userId: string) {}

  async getLatestPrice(ticker: string): Promise<PricePoint | null> {
    const intraday = await fetchSeries("int", ticker);
    if (intraday) {
      const point = latestFromSeries(ticker, intraday);
      if (point) return point;
    }
    const eod = await fetchSeries("eod", ticker);
    return eod ? latestFromSeries(ticker, eod) : null;
  }

  async getHistoricalPrices(ticker: string, startDate: string, endDate: string): Promise<PricePoint[]> {
    const eod = await fetchSeries("eod", ticker);
    if (!eod) return [];
    return eod
      .filter((r) => Number.isFinite(r[1]) && r[1] > 0)
      .map((r) => ({ ticker, price: r[1], date: pktDate(r[0]), source: PSX_PRICE_SOURCE }))
      .filter((p) => p.date >= startDate && p.date <= endDate)
      .reverse(); // oldest first
  }

  async refreshPortfolioPrices(userId: string): Promise<{ updated: number; skipped: string[] }> {
    const { data: holdings } = await this.supabase
      .from("holdings")
      .select("ticker")
      .eq("user_id", userId);
    const tickers = [...new Set((holdings ?? []).map((h) => h.ticker as string))];
    if (tickers.length === 0) return { updated: 0, skipped: [] };

    const points: PricePoint[] = [];
    const skipped: string[] = [];
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      const batch = tickers.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((t) => this.getLatestPrice(t)));
      results.forEach((p, idx) => (p ? points.push(p) : skipped.push(batch[idx])));
    }

    if (points.length > 0) {
      await this.supabase.from("prices").upsert(
        points.map((p) => ({
          user_id: userId,
          ticker: p.ticker,
          price: p.price,
          price_date: p.date,
          source: PSX_PRICE_SOURCE,
        })),
        { onConflict: "user_id,ticker,price_date" }
      );
    }
    return { updated: points.length, skipped };
  }
}

// --- Staleness rules (PKT = UTC+5, no DST) -------------------------------
// Generous trading window: weekdays 9:10–16:35 PKT (covers Friday's late
// close); "last close" pegged at 16:30 PKT.

function isMarketOpen(now: Date): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= 4 * 60 + 10 && mins <= 11 * 60 + 35; // 09:10–16:35 PKT
}

function lastMarketClose(now: Date): Date {
  for (let d = 0; d < 8; d++) {
    const c = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d, 11, 30)); // 16:30 PKT
    if (c <= now && c.getUTCDay() >= 1 && c.getUTCDay() <= 5) return c;
  }
  return new Date(now.getTime() - 86400000);
}

/**
 * Should we hit the PSX portal again? True when we've never fetched, when we
 * don't have the latest close yet, or when the market is open and the last
 * fetch is older than staleMinutes. Outside trading hours, once the close is
 * in, no further requests are made until the next session.
 */
export function needsRefresh(lastFetch: Date | null, staleMinutes: number, now = new Date()): boolean {
  if (!lastFetch) return true;
  const throttled = now.getTime() - lastFetch.getTime() < staleMinutes * 60_000;
  if (throttled) return false;
  if (lastFetch < lastMarketClose(now)) return true; // latest close not captured yet
  return isMarketOpen(now);
}
