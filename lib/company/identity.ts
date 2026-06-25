import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPsxSymbols, type PsxSymbolInfo } from "@/lib/market-data/psx-dps";

export interface CompanyIdentity {
  companyName: string | null;
  sector: string | null;
  source: string | null;
}

let directoryCache: { map: Map<string, PsxSymbolInfo>; at: number } | null = null;
const DIRECTORY_TTL_MS = 1000 * 60 * 60 * 12;

/** Cached PSX symbol directory — shared across metadata, search, and reports. */
export async function getPsxDirectory(): Promise<Map<string, PsxSymbolInfo>> {
  if (directoryCache && Date.now() - directoryCache.at < DIRECTORY_TTL_MS && directoryCache.map.size > 0) {
    return directoryCache.map;
  }
  const map = await fetchPsxSymbols();
  if (map.size > 0) directoryCache = { map, at: Date.now() };
  return map;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve ticker → company name + sector from local tables, then the official
 * PSX directory. Used whenever company_metadata is missing or incomplete.
 */
export async function resolveCompanyIdentity(
  supabase: SupabaseClient,
  ticker: string
): Promise<CompanyIdentity> {
  const t = ticker.toUpperCase();
  let companyName: string | null = null;
  let sector: string | null = null;
  let source: string | null = null;

  const [{ data: universe }, { data: master }] = await Promise.all([
    supabase.from("stock_universe").select("company_name, sector").eq("ticker", t).maybeSingle(),
    supabase.from("stock_master").select("company_name, sector").eq("ticker", t).maybeSingle(),
  ]);

  if (universe) {
    companyName = cleanText(universe.company_name) ?? companyName;
    sector = cleanText(universe.sector) ?? sector;
    if (companyName || sector) source = "stock-universe";
  }

  if (master) {
    companyName = companyName ?? cleanText(master.company_name);
    sector = sector ?? cleanText(master.sector);
    if (!source && (companyName || sector)) source = "stock-master";
  }

  if (!companyName || !sector) {
    const directory = await getPsxDirectory();
    const official = directory.get(t);
    if (official) {
      companyName = companyName ?? cleanText(official.name);
      sector = sector ?? cleanText(official.sector);
      source = source ?? "psx-directory";
    }
  }

  return { companyName, sector, source };
}

export function hasCompleteIdentity(companyName: string | null | undefined, sector: string | null | undefined): boolean {
  return !!(companyName?.trim() && sector?.trim());
}
