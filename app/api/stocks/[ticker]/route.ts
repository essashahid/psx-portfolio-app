import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getRatioCard } from "@/lib/chat/data";
import { getQuote } from "@/lib/company/quote";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getFundamentals } from "@/lib/company/fundamentals";
import { getCompanyFilings } from "@/lib/company/filings";
import { getClustersForTickers } from "@/lib/news/global-store";
import { computeRatios } from "@/lib/engine/ratios";
import { buildKeyFigures } from "@/lib/company/key-figures";
import {
  buildTrends,
  officialDescription,
  quoteFreshness,
  toCompanyFilings,
  toCompanyNews,
} from "@/lib/company/overview";
import type { CompanyResponse } from "@psx/shared/api/stocks";

export const maxDuration = 60;

/**
 * GET /api/stocks/[ticker]
 *
 * The per-ticker data endpoint: everything the platform knows about one
 * company as JSON: live quote, the full ratio card (valuation on a
 * trailing-12m basis with the forward/run-rate line beside it, and the
 * bank-specific set where the line items exist), hand-verification status,
 * latest filing periods, and recent payouts. The Overview block the phone
 * mirrors (description, trends, filings, news, key figures) is built from the
 * same lib helpers the web page uses, so both surfaces show identical figures.
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

    const [
      { data: master },
      quote,
      { data: cap },
      card,
      { data: payouts },
      { data: holding },
      { data: watched },
      metadata,
      fundamentals,
      filings,
      clusters,
      ratioRows,
    ] = await Promise.all([
      supabase.from("stock_master").select("company_name, sector").eq("ticker", ticker).maybeSingle(),
      // The same resolution the web header and the portfolio use, including
      // this user's own override, so the phone never shows a third price.
      getQuote(supabase, ticker, { userId: user.id }),
      supabase.from("market_quotes").select("market_cap").eq("ticker", ticker).maybeSingle(),
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
      getCompanyMetadata(supabase, ticker),
      getFundamentals(supabase, ticker),
      getCompanyFilings(ticker, 5, { supabase }),
      getClustersForTickers(supabase, [ticker], { limit: 3 }),
      computeRatios(supabase, ticker),
    ]);

    if (!master && quote.price === null && (card?.rows.length ?? 0) === 0) {
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

    return NextResponse.json<CompanyResponse>({
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
      quote:
        quote.price !== null
          ? {
              price: quote.price,
              prevClose: quote.prevClose,
              dayChangePct: quote.dayChangePct,
              marketCap: cap?.market_cap ?? null,
              asOf: quote.asOf,
              provider: quote.meta.source,
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
      description: officialDescription(metadata),
      trends: buildTrends(fundamentals),
      filings: toCompanyFilings(filings),
      news: toCompanyNews(clusters),
      keyFigures: buildKeyFigures(ratioRows),
      quoteFreshness: quoteFreshness(quote),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
