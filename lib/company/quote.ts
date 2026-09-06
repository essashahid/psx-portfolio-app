import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshQuote } from "@/lib/engine/market-data";
import { needsRefresh } from "@/lib/market-data/psx-dps";
import { resolveEffectivePrices } from "@/lib/portfolio/price-lookup";
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
 * Quote for the company header. The shared quote row is served first (a
 * missing row is fetched inline, a stale one is served now and refreshed in
 * the background), and then the price itself is passed through the same
 * resolution the portfolio uses, so the header and the dashboard can never
 * show two prices for one ticker.
 *
 * With a userId, the user's own override (a typed price or one from their
 * statement) is honoured exactly as it is in their portfolio. Day change is
 * withheld when the override wins: the market moved, the user's price did not.
 */
export async function getQuote(
  supabase: SupabaseClient,
  ticker: string,
  opts: { userId?: string | null } = {}
): Promise<Quote> {
  const t = ticker.toUpperCase();
  const { data: cached } = await supabase.from("market_quotes").select("*").eq("ticker", t).maybeSingle();

  let base: Quote;
  if (!cached) {
    const q = await refreshQuote(t).catch(() => null);
    base = q
      ? {
          ticker: t,
          price: q.price,
          prevClose: q.prevClose,
          dayChange: q.prevClose !== null ? q.price - q.prevClose : null,
          dayChangePct: q.prevClose ? ((q.price - q.prevClose) / q.prevClose) * 100 : null,
          volume: q.volume,
          asOf: q.asOf,
          meta: { source: q.provider, lastUpdated: new Date().toISOString(), freshness: "fresh" },
        }
      : toQuote(t, null, "missing");
  } else {
    const row = cached as QuoteRow;
    const stale = needsRefresh(row.last_fetched_at ? new Date(row.last_fetched_at) : null, STALE_MINUTES);
    if (stale) {
      // Serve the cached price now; refresh in the background for the next view.
      void refreshQuote(t).catch(() => null);
    }
    base = toQuote(t, row, stale ? "stale" : "fresh");
  }

  const effective = (await resolveEffectivePrices(supabase, opts.userId ?? null, [t])).get(t) ?? null;
  if (!effective) return base;
  if (effective.kind === "quote" || (base.price !== null && effective.price === base.price)) return base;

  // Something other than the shared quote won: the user's own price, or a
  // close the quote refresh has not caught up with. The header shows that
  // figure and nothing derived from a different one.
  return {
    ...base,
    price: effective.price,
    prevClose: effective.kind === "override" ? null : base.prevClose,
    dayChange: null,
    dayChangePct: null,
    asOf: effective.date,
    meta: {
      ...base.meta,
      source: effective.kind === "override" ? effective.source : base.meta.source ?? effective.source,
      freshness: base.meta.freshness === "missing" ? "fresh" : base.meta.freshness,
    },
  };
}
