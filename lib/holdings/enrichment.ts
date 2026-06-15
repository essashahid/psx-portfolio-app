import type { SupabaseClient } from "@supabase/supabase-js";
import { aiAvailable, chatJson } from "@/lib/ai/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPsxSymbols } from "@/lib/market-data/psx-dps";

type HoldingMetadataRow = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
};

type AiMetadata = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  confidence: number;
  rationale: string;
};

export type EnrichmentResult = {
  checked: number;
  alreadyComplete: number;
  updatedFromMaster: number;
  updatedFromAi: number;
  skippedLowConfidence: string[];
  aiSkipped: boolean;
  message: string;
};

const MIN_CONFIDENCE = 0.6;

export async function enrichHoldingsMetadata(
  supabase: SupabaseClient,
  userId: string,
  opts: { tickers?: string[]; useAi?: boolean } = {}
): Promise<EnrichmentResult> {
  let query = supabase
    .from("holdings")
    .select("ticker, company_name, sector")
    .eq("user_id", userId)
    .gt("quantity", 0)
    .order("ticker");

  const tickers = opts.tickers?.map((t) => t.toUpperCase().trim()).filter(Boolean);
  if (tickers?.length) query = query.in("ticker", [...new Set(tickers)]);

  const { data, error } = await query;
  if (error) throw error;

  const holdings = ((data ?? []) as HoldingMetadataRow[]).map((h) => ({
    ...h,
    ticker: h.ticker.toUpperCase(),
    company_name: cleanText(h.company_name),
    sector: cleanText(h.sector),
  }));

  const incomplete = holdings.filter(needsMetadata);
  if (holdings.length === 0 || incomplete.length === 0) {
    return resultMessage({
      checked: holdings.length,
      alreadyComplete: holdings.length,
      updatedFromMaster: 0,
      updatedFromAi: 0,
      skippedLowConfidence: [],
      aiSkipped: false,
    });
  }

  const masterMap = await getMasterMap(supabase, incomplete.map((h) => h.ticker));
  let updatedFromMaster = 0;
  for (const h of incomplete) {
    const m = masterMap.get(h.ticker);
    if (!m) continue;
    const patch = missingPatch(h, {
      company_name: cleanText(m.company_name),
      sector: cleanText(m.sector),
    });
    if (Object.keys(patch).length === 0) continue;
    await updateHolding(supabase, userId, h.ticker, patch);
    Object.assign(h, patch);
    updatedFromMaster++;
  }

  // Official PSX symbol directory — authoritative for anything still listed.
  const afterMaster = holdings.filter(needsMetadata);
  if (afterMaster.length > 0) {
    const psxDirectory = await fetchPsxSymbols();
    const officialRows: { ticker: string; company_name: string; sector: string | null }[] = [];
    for (const h of afterMaster) {
      const official = psxDirectory.get(h.ticker);
      if (!official) continue;
      const patch = missingPatch(h, {
        company_name: cleanText(official.name),
        sector: cleanText(official.sector),
      });
      if (Object.keys(patch).length === 0) continue;
      await updateHolding(supabase, userId, h.ticker, patch);
      Object.assign(h, patch);
      updatedFromMaster++;
      officialRows.push({
        ticker: h.ticker,
        company_name: h.company_name ?? official.name,
        sector: h.sector ?? null,
      });
    }
    await upsertStockMaster(officialRows);
  }

  const stillIncomplete = holdings.filter(needsMetadata);
  const shouldUseAi = opts.useAi ?? true;
  if (stillIncomplete.length === 0 || !shouldUseAi || !aiAvailable()) {
    return resultMessage({
      checked: holdings.length,
      alreadyComplete: holdings.length - incomplete.length,
      updatedFromMaster,
      updatedFromAi: 0,
      skippedLowConfidence: [],
      aiSkipped: stillIncomplete.length > 0,
    });
  }

  const aiRows = await classifyWithGemini(stillIncomplete);
  const byTicker = new Map(aiRows.map((r) => [r.ticker.toUpperCase(), r]));
  const skippedLowConfidence: string[] = [];
  const stockMasterRows: { ticker: string; company_name: string; sector: string | null }[] = [];
  let updatedFromAi = 0;

  for (const h of stillIncomplete) {
    const ai = byTicker.get(h.ticker);
    if (!ai) continue;
    const confidence = Number(ai.confidence);
    if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
      skippedLowConfidence.push(h.ticker);
      continue;
    }

    const patch = missingPatch(h, {
      company_name: cleanText(ai.company_name),
      sector: cleanText(ai.sector),
    });
    if (Object.keys(patch).length === 0) continue;

    await updateHolding(supabase, userId, h.ticker, patch);
    updatedFromAi++;

    const companyName = patch.company_name ?? h.company_name;
    if (companyName) {
      stockMasterRows.push({
        ticker: h.ticker,
        company_name: companyName,
        sector: patch.sector ?? h.sector ?? null,
      });
    }
  }

  await upsertStockMaster(stockMasterRows);

  return resultMessage({
    checked: holdings.length,
    alreadyComplete: holdings.length - incomplete.length,
    updatedFromMaster,
    updatedFromAi,
    skippedLowConfidence,
    aiSkipped: false,
  });
}

async function getMasterMap(supabase: SupabaseClient, tickers: string[]) {
  if (tickers.length === 0) return new Map<string, HoldingMetadataRow>();
  const { data } = await supabase
    .from("stock_master")
    .select("ticker, company_name, sector")
    .in("ticker", [...new Set(tickers)]);
  return new Map(((data ?? []) as HoldingMetadataRow[]).map((m) => [m.ticker.toUpperCase(), m]));
}

async function classifyWithGemini(holdings: HoldingMetadataRow[]): Promise<AiMetadata[]> {
  const { data } = await chatJson<{ holdings: AiMetadata[] }>(
    `You classify metadata for Pakistan Stock Exchange listed securities.
Use public knowledge of PSX-listed companies and PSX-style sector names.
Do not guess aggressively. If the company or sector is uncertain, return null for that field and set confidence below 0.6.
Return concise sector labels such as Commercial Banks, Cement, Fertilizer, Engineering, Textile Composite, Technology & Communication, Oil & Gas Exploration, Oil & Gas Marketing, Power Generation & Distribution, Pharmaceuticals, Automobile Assembler, Cable & Electrical Goods, Chemical, Real Estate Investment Trust, Modarabas, or the most accurate PSX-style sector.
Return JSON: {"holdings":[{"ticker":"...", "company_name":"official company name or null", "sector":"sector or null", "confidence":0.0-1.0, "rationale":"max 12 words"}]}.`,
    `Classify these current holdings:\n${JSON.stringify(holdings, null, 2)}`,
    1800
  );
  return data.holdings ?? [];
}

async function updateHolding(
  supabase: SupabaseClient,
  userId: string,
  ticker: string,
  patch: Partial<Pick<HoldingMetadataRow, "company_name" | "sector">>
) {
  const { error } = await supabase
    .from("holdings")
    .update({ ...patch, last_updated: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("ticker", ticker);
  if (error) throw error;
}

async function upsertStockMaster(rows: { ticker: string; company_name: string; sector: string | null }[]) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || rows.length === 0) return;
  const admin = createAdminClient();
  await admin.from("stock_master").upsert(rows, { onConflict: "ticker" });
}

function needsMetadata(h: HoldingMetadataRow): boolean {
  return !h.company_name || !h.sector;
}

function missingPatch(
  current: HoldingMetadataRow,
  candidate: Partial<Pick<HoldingMetadataRow, "company_name" | "sector">>
) {
  const patch: Partial<Pick<HoldingMetadataRow, "company_name" | "sector">> = {};
  if (!current.company_name && candidate.company_name) patch.company_name = candidate.company_name;
  if (!current.sector && candidate.sector) patch.sector = candidate.sector;
  return patch;
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned && cleaned !== "—" ? cleaned : null;
}

function resultMessage(result: Omit<EnrichmentResult, "message">): EnrichmentResult {
  const updated = result.updatedFromMaster + result.updatedFromAi;
  const skipped = result.skippedLowConfidence.length;
  const message =
    updated > 0
      ? `${updated} holding${updated === 1 ? "" : "s"} enriched (${result.updatedFromMaster} from PSX directory/stock master, ${result.updatedFromAi} from Gemini).`
      : result.aiSkipped
        ? "No metadata updated. Gemini is not configured, so unresolved sectors remain blank."
        : skipped > 0
          ? `No metadata updated. ${skipped} low-confidence classification${skipped === 1 ? "" : "s"} skipped.`
          : "All holding metadata is already complete.";
  return { ...result, message };
}
