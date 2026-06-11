import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals } from "@/lib/company/technicals";
import { getQuote } from "@/lib/company/quote";
import type { CompanyHeader } from "@/lib/company/types";

/**
 * Everything the cockpit shell needs to paint the top summary in one shot:
 * profile + best-available quote + 52-week range. All three are cache-first
 * (DB tables), fetched in parallel; the quote engine falls back across
 * providers and revalidates stale rows in the background.
 */
export async function getCompanyHeader(
  supabase: SupabaseClient,
  ticker: string
): Promise<CompanyHeader> {
  const t = ticker.toUpperCase();
  const [metadata, quote, technicals] = await Promise.all([
    getCompanyMetadata(supabase, t),
    getQuote(supabase, t),
    getTechnicals(supabase, t),
  ]);

  // The technicals snapshot can carry a fresher price than a missing quote row.
  if (quote.price === null && technicals.latestPrice !== null) {
    quote.price = technicals.latestPrice;
    quote.prevClose = technicals.prevClose;
    quote.dayChangePct = technicals.dayChangePct;
    quote.dayChange =
      technicals.latestPrice !== null && technicals.prevClose !== null
        ? technicals.latestPrice - technicals.prevClose
        : null;
    quote.asOf = technicals.asOfDate;
    quote.meta = technicals.meta;
  }

  // Derive market cap when we know the share count and have a live price.
  if (metadata.marketCap === null && metadata.sharesOutstanding && quote.price) {
    metadata.marketCap = metadata.sharesOutstanding * quote.price;
  }

  return {
    metadata,
    quote,
    technicals: {
      fiftyTwoWeekHigh: technicals.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: technicals.fiftyTwoWeekLow,
      asOfDate: technicals.asOfDate,
    },
  };
}
