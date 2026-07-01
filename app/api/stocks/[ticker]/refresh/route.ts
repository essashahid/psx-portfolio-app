import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { refreshTechnicals } from "@/lib/company/technicals";
import { saveCompanyDescription } from "@/lib/company/metadata";
import { fetchPsxCompanyProfile } from "@/lib/company/psx-profile";
import { refreshQuote, refreshHistory, testProviderCoverage } from "@/lib/engine/market-data";
import { populateAllFundamentals } from "@/lib/engine/fundamentals";
import { refreshRatios } from "@/lib/engine/ratios";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 120;

/**
 * POST /api/stocks/[ticker]/refresh { section }
 *   section = "quote"       → best-available quote via the provider chain
 *   section = "history"     → daily candles via the provider chain
 *   section = "technicals"  → recompute indicators from stored/PSX history
 *   section = "financials"  → extract statements from latest result filings
 *   section = "ratios"      → recompute ratios from stored financials + quote
 *   section = "coverage"    → probe every provider for this ticker
 *   section = "description" → fetch the official PSX company profile (cached)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const { ticker: raw } = await params;
    const ticker = decodeURIComponent(raw).toUpperCase();
    const body = (await request.json().catch(() => ({}))) as { section?: string };
    const section = body.section ?? "technicals";

    if (section === "quote") {
      const q = await refreshQuote(ticker);
      return NextResponse.json({
        message: q
          ? `Quote refreshed from ${q.provider} (${q.price} as of ${q.asOf}).`
          : `No market data provider currently has coverage for ${ticker}.`,
      });
    }

    if (section === "history") {
      const h = await refreshHistory(ticker);
      return NextResponse.json({
        message: h
          ? `${h.candles.length} daily candles stored from ${h.provider}.`
          : `No provider has historical data for ${ticker}.`,
      });
    }

    if (section === "technicals") {
      const t = await refreshTechnicals(ticker);
      return NextResponse.json({
        message: t.asOfDate
          ? `Technicals refreshed (as of ${t.asOfDate}).`
          : `No PSX price history found for ${ticker}.`,
      });
    }

    if (section === "financials") {
      const r = await populateAllFundamentals(ticker);
      const parts: string[] = [];
      if (r.pagePeriods) parts.push(`${r.pagePeriods} period(s) from the PSX page`);
      if (r.extracted) parts.push(`${r.extracted} statement(s) from filings`);
      if (r.payouts) parts.push(`${r.payouts} payout(s)`);
      return NextResponse.json({
        message: parts.length
          ? `Loaded ${parts.join(", ")}. ${r.ratios?.available ?? 0}/${r.ratios?.computed ?? 0} ratios now computable.`
          : r.errors[0] ?? `No financial data found for ${ticker}.`,
        detail: r,
      });
    }

    if (section === "ratios") {
      const r = await refreshRatios(supabase, ticker);
      return NextResponse.json({
        message: `${r.available} of ${r.computed} ratios computable from stored data.`,
      });
    }

    if (section === "coverage") {
      const results = await testProviderCoverage(ticker);
      const working = results.filter((r) => r.quote || r.history).map((r) => r.provider);
      return NextResponse.json({
        message: working.length
          ? `Coverage: ${working.join(", ")}.`
          : `No provider has coverage for ${ticker}.`,
        results,
      });
    }

    if (section === "description") {
      const data = await fetchPsxCompanyProfile(ticker);
      if (!data) {
        return NextResponse.json({ message: `No official PSX company profile found for ${ticker}.` }, { status: 404 });
      }
      await saveCompanyDescription(ticker, {
        description: data.businessDescription,
        business_lines: [],
        website: data.website,
        source: "psx-company-page",
        source_url: data.sourceUrl,
        confidence: 1,
      });
      return NextResponse.json({ message: `Official PSX company profile saved for ${ticker}.` });
    }

    return NextResponse.json({ error: `Unknown section "${section}".` }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
