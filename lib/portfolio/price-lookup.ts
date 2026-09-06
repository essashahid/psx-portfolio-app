import type { SupabaseClient } from "@supabase/supabase-js";
import { pickEffectivePrice, type EffectivePrice, type PriceCandidate } from "@/lib/portfolio/effective-price";

/**
 * Load the price candidates for a set of tickers and resolve each through
 * pickEffectivePrice. Three round trips however many tickers are asked for:
 * the user's own rows (latest_prices, migration 0026), the shared quotes, and
 * the latest closes (latest_closes, migration 0045).
 *
 * Every surface that values a position calls this: getPortfolio for the
 * dashboard, holdings, phone and Copilot; getQuote for the company header.
 * That is the whole point. Do not add a fourth caller that reads a price
 * table directly.
 */
export async function resolveEffectivePrices(
  supabase: SupabaseClient,
  userId: string | null,
  tickers: string[]
): Promise<Map<string, EffectivePrice>> {
  const out = new Map<string, EffectivePrice>();
  const list = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (list.length === 0) return out;

  const [userRes, quoteRes, closeRes] = await Promise.all([
    userId
      ? supabase.rpc("latest_prices", { p_user_id: userId, p_tickers: list })
      : Promise.resolve({ data: [] as { ticker: string; price: number; price_date: string; source: string }[] }),
    supabase.from("market_quotes").select("ticker, price, as_of, provider").in("ticker", list),
    supabase.rpc("latest_closes", { p_tickers: list }),
  ]);

  const userRows = new Map<string, PriceCandidate>();
  for (const r of (userRes.data ?? []) as { ticker: string; price: number; price_date: string; source: string }[]) {
    userRows.set(r.ticker, { price: Number(r.price), date: String(r.price_date).slice(0, 10), source: r.source ?? "manual" });
  }
  const quotes = new Map<string, PriceCandidate>();
  for (const r of (quoteRes.data ?? []) as { ticker: string; price: number | null; as_of: string | null; provider: string | null }[]) {
    if (r.price === null || !r.as_of) continue;
    quotes.set(r.ticker, { price: Number(r.price), date: String(r.as_of).slice(0, 10), source: r.provider ?? "quote" });
  }
  const closes = new Map<string, PriceCandidate>();
  for (const r of (closeRes.data ?? []) as { ticker: string; close: number; price_date: string; source: string | null }[]) {
    closes.set(r.ticker, { price: Number(r.close), date: String(r.price_date).slice(0, 10), source: r.source ?? "close" });
  }

  for (const t of list) {
    const picked = pickEffectivePrice({ userRow: userRows.get(t), quote: quotes.get(t), close: closes.get(t) });
    if (picked) out.set(t, picked);
  }
  return out;
}
