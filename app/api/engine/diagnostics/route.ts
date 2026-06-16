import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { providerConfigs } from "@/lib/providers/env";
import { testProviderCoverage } from "@/lib/engine/market-data";

export const maxDuration = 60;

/** GET — provider config + health + universe coverage counts for the dashboard. */
export async function GET() {
  const { supabase, error } = await requireUser();
  if (error) return error;

  try {
    const [statusRes, universeRes, quotesRes, histRes, techRes, finRes, ratioRes, logsRes] = await Promise.all([
      supabase.from("data_provider_status").select("*"),
      supabase.from("stock_universe").select("ticker", { count: "exact", head: true }),
      supabase.from("market_quotes").select("ticker", { count: "exact", head: true }),
      supabase.from("company_price_history").select("ticker", { count: "exact", head: true }).limit(1),
      supabase.from("company_technicals").select("ticker", { count: "exact", head: true }),
      supabase.from("company_financials").select("ticker", { count: "exact", head: true }),
      supabase.from("company_ratios").select("ticker", { count: "exact", head: true }),
      supabase.from("data_fetch_logs").select("ticker, section, source, status, detail, created_at").order("created_at", { ascending: false }).limit(25),
    ]);

    // Distinct-ticker counts for history/financials/ratios need aggregation;
    // head counts above count rows, so fetch distinct tickers cheaply.
    const [histTickers, finTickers, ratioTickers, divTickers] = await Promise.all([
      supabase.from("company_technicals").select("ticker").not("as_of_date", "is", null),
      supabase.from("company_financials").select("ticker"),
      supabase.from("company_ratios").select("ticker").not("ratio_value", "is", null),
      supabase.from("dividends").select("ticker").not("ticker", "is", null),
    ]);
    const distinct = (rows: { ticker: string }[] | null) => new Set((rows ?? []).map((r) => r.ticker)).size;

    return NextResponse.json({
      providers: providerConfigs().map((p) => {
        const status = (statusRes.data ?? []).find((s) => s.provider === p.name);
        return {
          ...p,
          healthy: status?.healthy ?? null,
          lastSuccess: status?.last_success_at ?? null,
          lastError: status?.last_error ?? null,
          lastErrorAt: status?.last_error_at ?? null,
          rateLimited: status?.rate_limited ?? false,
        };
      }),
      coverage: {
        universe: universeRes.count ?? 0,
        quotes: quotesRes.count ?? 0,
        priceHistoryRows: histRes.count ?? 0,
        technicalRows: techRes.count ?? 0,
        technicals: distinct(histTickers.data),
        financialsTickers: distinct(finTickers.data),
        financialStatements: finRes.count ?? 0,
        ratioTickers: distinct(ratioTickers.data),
        ratioRows: ratioRes.count ?? 0,
        dividendTickers: distinct(divTickers.data),
      },
      recentFetches: logsRes.data ?? [],
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { ticker } — live provider coverage probe for one ticker. */
export async function POST(request: Request) {
  const { error } = await requireUser();
  if (error) return error;
  try {
    const body = (await request.json()) as { ticker?: string };
    const ticker = (body.ticker ?? "").toUpperCase().trim();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    const results = await testProviderCoverage(ticker);
    return NextResponse.json({ ticker, results });
  } catch (err) {
    return errorResponse(err);
  }
}
