import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "@/lib/ai/openai";
import type { AiReportNarrative, CompanyReportPayload, CompanyReportOptions, AiReportInsight } from "./types";
import { normalizeNarrative } from "./markdown";
import { buildSectionPrompt } from "./prompt-builder";

const SECTION_NARRATIVE_KEYS: Record<string, keyof AiReportNarrative> = {
  businessOverview: "businessOverview",
  financials: "financialPerformance",
  financialQuality: "financialQuality",
  valuation: "valuation",
  dividends: "dividends",
  pricePerformance: "pricePerformance",
  catalystsRisks: "catalysts",
  portfolio: "portfolio",
  monitoring: "monitoring",
  news: "recentDevelopments",
};

const SECTION_SYSTEM = `You write professional PSX research section insights. Return JSON only. No Markdown formatting block.`;

export async function regenerateReportSection(
  sectionKey: string,
  symbol: string,
  evidence: Record<string, unknown>,
  options: CompanyReportOptions,
  existing: CompanyReportPayload
): Promise<Partial<AiReportNarrative>> {
  const narrativeKey = SECTION_NARRATIVE_KEYS[sectionKey];
  if (!narrativeKey) throw new Error(`Unknown section: ${sectionKey}`);

  const sectionEvidence = pickSectionEvidence(sectionKey, evidence);
  const company = evidence.company as { sector?: string } | undefined;
  
  const prompt = buildSectionPrompt(sectionKey, symbol, options, company?.sector ?? null);
  const expectedShape = `{"${narrativeKey}":[{"text":"insight","citations":["S1"]}]}`;

  let lastErr: Error | null = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data } = await chatJson<Record<string, AiReportInsight[]>>(
        SECTION_SYSTEM,
        [
          prompt,
          `Return exactly this JSON shape:`,
          expectedShape,
          "Evidence:",
          JSON.stringify(sectionEvidence, null, 2),
        ].join("\n"),
        options.depth === "full" ? 1800 : 1200
      );

      // Validate response shape
      if (!data || typeof data !== "object" || !Array.isArray(data[narrativeKey as string])) {
        throw new Error(`Invalid JSON shape from model. Missing array for key: ${String(narrativeKey)}`);
      }

      const partial = normalizeNarrative(data as Partial<AiReportNarrative>);
      
      // Enforce substantive response
      if (partial[narrativeKey].length === 0) {
        throw new Error("Model returned empty insights array.");
      }
      
      return { [narrativeKey]: partial[narrativeKey] };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === 3) break;
      // Wait before retry
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  throw new Error(`Failed to regenerate section ${sectionKey} after 3 attempts: ${lastErr?.message}`);
}

export function mergeSectionNarrative(
  existing: AiReportNarrative,
  partial: Partial<AiReportNarrative>
): AiReportNarrative {
  return normalizeNarrative({ ...existing, ...partial });
}

function pickSectionEvidence(sectionKey: string, evidence: Record<string, unknown>): Record<string, unknown> {
  const base = { company: evidence.company, quote: evidence.quote, sourceRegister: evidence.sourceRegister, displayUnit: evidence.displayUnit };
  switch (sectionKey) {
    case "financials":
      return { ...base, financials: evidence.financials, ratios: evidence.ratios };
    case "valuation":
      return { ...base, ratios: evidence.ratios, peers: evidence.peers };
    case "dividends":
      return { ...base, payouts: evidence.payouts, userDividends: evidence.userDividends };
    case "pricePerformance":
      return { ...base, technicals: evidence.technicals };
    case "peers":
      return { ...base, peers: evidence.peers };
    case "portfolio":
      return { ...base, portfolio: evidence.portfolio };
    case "news":
      return { ...base, independentNews: evidence.independentNews, officialFilings: evidence.officialFilings };
    case "catalystsRisks":
      return { ...base, independentNews: evidence.independentNews, officialFilings: evidence.officialFilings, financials: evidence.financials };
    default:
      return base;
  }
}

export async function refreshReportSectionData(
  supabase: SupabaseClient,
  userId: string,
  sectionKey: string,
  payload: CompanyReportPayload
): Promise<CompanyReportPayload> {
  // Section-specific data refresh is handled by full regen for news/peers; narrative-only for others
  if (sectionKey === "news") {
    const { filterAndDedupeNews, buildCompanyContext, separateFilingsFromNews } = await import("./news");
    const company = payload.evidence.company as { companyName: string; sector: string };
    const ctx = buildCompanyContext(payload.ticker, company.companyName, company.sector);
    const filings = (payload.evidence.filings as { title: string; url: string; date: string | null; category: string }[]) ?? [];
    const filtered = filterAndDedupeNews([], ctx, 0.45, 14, payload.options.newsPeriodDays);
    const separated = separateFilingsFromNews(filtered, filings);
    payload.evidence.independentNews = separated.independentNews;
    payload.evidence.sectorNews = separated.sectorNews;
  }
  const partial = await regenerateReportSection(sectionKey, payload.ticker, payload.evidence, payload.options, payload);
  payload.narrative = mergeSectionNarrative(payload.narrative, partial);
  return payload;
}
