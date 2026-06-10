import type { SupabaseClient } from "@supabase/supabase-js";

export interface PricePoint {
  ticker: string;
  price: number;
  date: string; // YYYY-MM-DD
  source: string;
}

/**
 * Market-data adapter. The app never talks to a price source directly —
 * everything goes through this interface so a real PSX data provider can be
 * plugged in later without touching the rest of the codebase.
 */
export interface MarketDataProvider {
  readonly name: string;
  /** Latest known price, or null if unavailable. */
  getLatestPrice(ticker: string): Promise<PricePoint | null>;
  getHistoricalPrices(ticker: string, startDate: string, endDate: string): Promise<PricePoint[]>;
  /**
   * Refreshes prices for every holding of a user and writes them to the prices
   * table. Returns the number of tickers updated.
   */
  refreshPortfolioPrices(userId: string): Promise<{ updated: number; skipped: string[] }>;
}

/**
 * Manual provider (default). Prices come from the user's own `prices` table —
 * fed by manual edits, CSV uploads, and market prices found on imported
 * statements. refreshPortfolioPrices is a no-op beyond reporting coverage.
 */
export class ManualProvider implements MarketDataProvider {
  readonly name = "manual";
  constructor(private supabase: SupabaseClient, private userId: string) {}

  async getLatestPrice(ticker: string): Promise<PricePoint | null> {
    const { data } = await this.supabase
      .from("prices")
      .select("ticker, price, price_date, source")
      .eq("user_id", this.userId)
      .eq("ticker", ticker)
      .order("price_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return { ticker: data.ticker, price: Number(data.price), date: data.price_date, source: data.source };
  }

  async getHistoricalPrices(ticker: string, startDate: string, endDate: string): Promise<PricePoint[]> {
    const { data } = await this.supabase
      .from("prices")
      .select("ticker, price, price_date, source")
      .eq("user_id", this.userId)
      .eq("ticker", ticker)
      .gte("price_date", startDate)
      .lte("price_date", endDate)
      .order("price_date", { ascending: true });
    return (data ?? []).map((p) => ({
      ticker: p.ticker,
      price: Number(p.price),
      date: p.price_date,
      source: p.source,
    }));
  }

  async refreshPortfolioPrices(userId: string): Promise<{ updated: number; skipped: string[] }> {
    const { data: holdings } = await this.supabase
      .from("holdings")
      .select("ticker")
      .eq("user_id", userId);
    const skipped: string[] = [];
    for (const h of holdings ?? []) {
      const latest = await this.getLatestPrice(h.ticker);
      if (!latest) skipped.push(h.ticker);
    }
    return { updated: 0, skipped };
  }
}

/**
 * Template for a real provider. Wire MARKET_DATA_PROVIDER / MARKET_DATA_API_KEY
 * to an actual PSX data API here, fetch quotes, and upsert into `prices` with
 * source "provider".
 */
export class ExternalProvider implements MarketDataProvider {
  readonly name: string;
  constructor(
    name: string,
    private supabase: SupabaseClient,
    private userId: string
  ) {
    this.name = name;
  }

  async getLatestPrice(): Promise<PricePoint | null> {
    throw new Error(
      `Market data provider "${this.name}" is configured but not implemented. Add it in lib/market-data/adapter.ts.`
    );
  }
  async getHistoricalPrices(): Promise<PricePoint[]> {
    throw new Error(`Market data provider "${this.name}" is not implemented.`);
  }
  async refreshPortfolioPrices(): Promise<{ updated: number; skipped: string[] }> {
    throw new Error(`Market data provider "${this.name}" is not implemented.`);
  }
}

export function getMarketDataProvider(
  supabase: SupabaseClient,
  userId: string
): MarketDataProvider {
  const configured = (process.env.MARKET_DATA_PROVIDER ?? "manual").toLowerCase();
  if (configured === "manual" || configured === "") {
    return new ManualProvider(supabase, userId);
  }
  return new ExternalProvider(configured, supabase, userId);
}
