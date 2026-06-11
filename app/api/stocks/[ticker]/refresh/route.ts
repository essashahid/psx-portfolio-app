import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { refreshTechnicals } from "@/lib/company/technicals";
import { getCompanyMetadata, saveCompanyDescription } from "@/lib/company/metadata";
import { aiConfigured, chatJson } from "@/lib/ai/openai";

export const maxDuration = 60;

/**
 * POST /api/stocks/[ticker]/refresh { section }
 *   section = "technicals"  → recompute indicators from the PSX portal
 *   section = "description" → generate the AI company profile (cached)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { supabase, error } = await requireUser();
  if (error) return error;

  try {
    const { ticker: raw } = await params;
    const ticker = decodeURIComponent(raw).toUpperCase();
    const body = (await request.json().catch(() => ({}))) as { section?: string };
    const section = body.section ?? "technicals";

    if (section === "technicals") {
      const t = await refreshTechnicals(ticker);
      return NextResponse.json({
        message: t.asOfDate
          ? `Technicals refreshed (as of ${t.asOfDate}).`
          : `No PSX price history found for ${ticker}.`,
      });
    }

    if (section === "description") {
      if (!aiConfigured()) {
        return NextResponse.json({ error: "GEMINI_API_KEY is not configured." }, { status: 503 });
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
