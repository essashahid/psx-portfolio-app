import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { refreshTechnicals } from "@/lib/company/technicals";
import { getCompanyMetadata, saveCompanyDescription } from "@/lib/company/metadata";
import { aiAvailable, chatJson } from "@/lib/ai/openai";
import { refreshQuote, refreshHistory, testProviderCoverage } from "@/lib/engine/market-data";
import { populateAllFundamentals } from "@/lib/engine/fundamentals";
import { refreshRatios } from "@/lib/engine/ratios";
import { accountHasFeature } from "@/lib/features";
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
 *   section = "description" → generate the AI company profile (cached)
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
      if (!(await accountHasFeature(supabase, user.id, "company_enrichment"))) {
        return NextResponse.json({ error: "Company profile generation is disabled for this account." }, { status: 403 });
      }
      if (!aiAvailable()) {
        return NextResponse.json({ error: "AI provider is not configured. Add TASKS_API_KEY or DEEPSEEK_API_KEY in .env.local." }, { status: 503 });
      }
      const meta = await getCompanyMetadata(supabase, ticker);
      const { data } = await chatJson<{ description: string; industry: string; business_lines: string[] }>(
        `You write concise, factual company profiles for Pakistan Stock Exchange (PSX) listed companies, using only well-established public knowledge. If you are unsure what the company does, say so plainly rather than inventing details. Do not include any price targets, ratings, or buy/sell language.`,
        `Write a profile for PSX ticker ${ticker}${meta.companyName ? ` (${meta.companyName})` : ""}${meta.sector ? `, sector: ${meta.sector}` : ""}.
Return JSON: {"description": "2-4 sentence plain-English business description", "industry": "specific industry", "business_lines": ["key business line", "..."]}. If unknown, return {"description": "Limited public information is available for this PSX listing.", "industry": "", "business_lines": []}.`,
        700
      );
      await saveCompanyDescription(ticker, {
        description: data.description,
        industry: data.industry || undefined,
        business_lines: data.business_lines?.length ? data.business_lines : undefined,
      });
      return NextResponse.json({ message: `Company profile generated for ${ticker}.` });
    }

    return NextResponse.json({ error: `Unknown section "${section}".` }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
