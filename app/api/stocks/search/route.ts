import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { searchStocks } from "@/lib/company/search";

export const maxDuration = 30;

/**
 * GET /api/stocks/search?q=meb[&sector=Commercial Banks]
 * Returns ranked PSX matches enriched with the user's ownership + watchlist
 * status and the latest cached price, so the search UI can render owned/watch
 * badges and a price without a second round-trip.
 */
export async function GET(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const sector = url.searchParams.get("sector") ?? undefined;
    if (q.trim().length < 1) return NextResponse.json({ results: [] });

    const results = await searchStocks(supabase, q, { sector, limit: 20 });
    const tickers = results.map((r) => r.ticker);
    if (tickers.length === 0) return NextResponse.json({ results: [] });

    const [{ data: holdings }, { data: watch }, { data: prices }] = await Promise.all([
      supabase.from("holdings").select("ticker, quantity").eq("user_id", user.id).in("ticker", tickers).gt("quantity", 0),
      supabase.from("stock_watchlist").select("ticker").eq("user_id", user.id).in("ticker", tickers),
      supabase
        .from("company_technicals")
        .select("ticker, latest_price, day_change_pct")
        .in("ticker", tickers),
    ]);

    const owned = new Set((holdings ?? []).map((h) => h.ticker.toUpperCase()));
    const watched = new Set((watch ?? []).map((w) => w.ticker.toUpperCase()));
    const priceMap = new Map((prices ?? []).map((p) => [p.ticker.toUpperCase(), p]));

    return NextResponse.json({
      results: results.map((r) => {
        const p = priceMap.get(r.ticker);
        return {
          ...r,
          owned: owned.has(r.ticker),
          watched: watched.has(r.ticker),
          price: p?.latest_price ?? null,
          dayChangePct: p?.day_change_pct ?? null,
        };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
