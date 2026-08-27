import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getRatioCard } from "@/lib/chat/data";

export const maxDuration = 60;

/**
 * GET /api/stocks/[ticker]
 *
 * The per-ticker data endpoint: everything the platform knows about one
 * company as JSON — live quote, the full ratio card (valuation on a
 * trailing-12m basis with the forward/run-rate line beside it, and the
 * bank-specific set where the line items exist), hand-verification status,
 * latest filing periods, and recent payouts.
 *
 *   GET /api/stocks/MEBL
 *   {
 *     "ticker": "MEBL",
 *     "name": "Meezan Bank Limited",
 *     "sector": "Commercial Banks",
 *     "quote": { "price": 566.77, "asOf": "2026-07-06", ... },
 *     "verified": { "status": "verified", "throughPeriod": "2026 Q1", ... },
 *     "periods": { "latestAnnual": "2025 FY", "latestInterim": "2026 Q1" },
 *     "ratios": [ { "name": "P/E", "value": 11.28, "period": "TTM to 2026 Q1" }, ... ],
 *     "payouts": [ { "date": "2026-03-20", "kind": "cash", "dps": 7 }, ... ]
 *   }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const { ticker: raw } = await params;
    const ticker = decodeURIComponent(raw).toUpperCase();

    const [{ data: master }, { data: quote }, card, { data: payouts }, { data: holding }, { data: watched }] =
      await Promise.all([
      supabase.from("stock_master").select("company_name, sector").eq("ticker", ticker).maybeSingle(),
      supabase
        .from("market_quotes")
        .select("price, prev_close, day_change_pct, market_cap, as_of, provider")
        .eq("ticker", ticker)
        .maybeSingle(),
      getRatioCard(supabase, ticker),
      supabase
        .from("company_payouts")
        .select("announcement_date, kind, dividend_per_share, percentage")
        .eq("ticker", ticker)
        .order("announcement_date", { ascending: false })
        .limit(12),
      // The caller's own relationship to this company, so a screen can offer to
      // edit the position or watch the ticker without a second round trip.
      supabase
        .from("holdings")
        .select("quantity, avg_cost, total_cost, notes, hidden")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .maybeSingle(),
      supabase
        .from("stock_watchlist")
        .select("ticker")
        .eq("user_id", user.id)
        .eq("ticker", ticker)
        .maybeSingle(),
    ]);

    if (!master && !quote && (card?.rows.length ?? 0) === 0) {
      return NextResponse.json({
      position: holding
        ? {
            quantity: Number(holding.quantity),
            avgCost: holding.avg_cost === null ? null : Number(holding.avg_cost),
            totalCost: holding.total_cost === null ? null : Number(holding.total_cost),
            notes: holding.notes ?? null,
            hidden: Boolean(holding.hidden),
          }
        : null,
      watched: Boolean(watched), error: `No data for ${ticker}.` }, { status: 404 });
    }

    return NextResponse.json({
      position: holding
        ? {
            quantity: Number(holding.quantity),
            avgCost: holding.avg_cost === null ? null : Number(holding.avg_cost),
            totalCost: holding.total_cost === null ? null : Number(holding.total_cost),
            notes: holding.notes ?? null,
            hidden: Boolean(holding.hidden),
          }
        : null,
      watched: Boolean(watched),
      ticker,
      name: master?.company_name ?? null,
      sector: master?.sector ?? null,
      quote: quote
        ? {
            price: quote.price,
            prevClose: quote.prev_close,
            dayChangePct: quote.day_change_pct,
            marketCap: quote.market_cap,
            asOf: quote.as_of,
            provider: quote.provider,
          }
        : null,
      verified: card?.verified ?? null,
      periods: {
        latestAnnual: card?.latestAnnualPeriod ?? null,
        latestInterim: card?.latestInterimPeriod ?? null,
      },
      priceUsed: card?.priceUsed ?? null,
      // Ratio values carry binary-float artifacts from the arithmetic
      // (10.410000000000002); round at the boundary so consumers do not each
      // have to. The stored value stays full precision.
      ratios: (card?.rows ?? []).map((r) => ({
        ...r,
        value: typeof r.value === "number" && Number.isFinite(r.value) ? Number(r.value.toFixed(4)) : r.value,
      })),
      payouts: (payouts ?? []).map((p) => ({
        date: p.announcement_date,
        kind: p.kind,
        dps: p.dividend_per_share,
        percentage: p.percentage,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
