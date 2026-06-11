import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals, quoteFromTechnicals } from "@/lib/company/technicals";
import type { CompanyHeader } from "@/lib/company/types";

/**
 * Everything the cockpit shell needs to paint the top summary in one shot:
 * profile + live quote + 52-week range. Metadata and technicals are fetched in
 * parallel and both are cache-first, so a warm ticker resolves from the DB
 * without touching any external API.
 */
export async function getCompanyHeader(
  supabase: SupabaseClient,
  ticker: string
): Promise<CompanyHeader> {
  const t = ticker.toUpperCase();
  const [metadata, technicals] = await Promise.all([
    getCompanyMetadata(supabase, t),
    getTechnicals(supabase, t),
  ]);

  const quote = quoteFromTechnicals(technicals);

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
