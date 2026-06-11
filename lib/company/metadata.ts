import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPsxSymbols } from "@/lib/market-data/psx-dps";
import { freshnessFor, isStaleOrMissing, TTL_MINUTES } from "@/lib/company/freshness";
import type { CompanyMetadata, Freshness } from "@/lib/company/types";

function hasServiceRole(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

interface MetadataRow {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  face_value: number | null;
  shares_outstanding: number | null;
  market_cap: number | null;
  website: string | null;
  description: string | null;
  business_lines: string[] | null;
  source: string | null;
  source_url: string | null;
  confidence: number | null;
  last_fetched_at: string | null;
  last_updated: string | null;
}

function toMetadata(ticker: string, row: MetadataRow | null, freshness: Freshness): CompanyMetadata {
  return {
    ticker,
    companyName: row?.company_name ?? null,
    sector: row?.sector ?? null,
    industry: row?.industry ?? null,
    exchange: row?.exchange ?? "PSX",
    faceValue: row?.face_value ?? null,
    sharesOutstanding: row?.shares_outstanding ?? null,
    marketCap: row?.market_cap ?? null,
    website: row?.website ?? null,
    description: row?.description ?? null,
    businessLines: row?.business_lines ?? [],
    meta: {
      source: row?.source ?? null,
      sourceUrl: row?.source_url ?? null,
      lastUpdated: row?.last_updated ?? null,
      freshness,
    },
  };
}

/**
 * Company profile, served cache-first. On a cache miss/stale row it backfills
 * cheap fields (name, sector, face value) from stock_master and — only when
 * those are still blank — the official PSX symbol directory, then caches the
 * result. The expensive AI description is generated separately, on demand,
 * via refreshCompanyDescription so the page shell never waits on it.
 */
export async function getCompanyMetadata(
  supabase: SupabaseClient,
  ticker: string
): Promise<CompanyMetadata> {
  const t = ticker.toUpperCase();
  const { data: cached } = await supabase
    .from("company_metadata")
    .select("*")
    .eq("ticker", t)
    .maybeSingle();

  const freshness = freshnessFor(cached?.last_fetched_at ?? null, TTL_MINUTES.metadata);
  if (cached && !isStaleOrMissing(freshness)) {
    return toMetadata(t, cached as MetadataRow, freshness);
  }

  // Refresh cheap fields. Never throw — a flaky upstream must not break the page.
  try {
    const fresh = await buildBaseMetadata(supabase, t, cached as MetadataRow | null);
    if (fresh) return fresh;
  } catch {
    /* fall through to whatever we already had */
  }

  return toMetadata(t, (cached as MetadataRow) ?? null, cached ? "stale" : "missing");
}

async function buildBaseMetadata(
  supabase: SupabaseClient,
  ticker: string,
  existing: MetadataRow | null
): Promise<CompanyMetadata | null> {
  let companyName = existing?.company_name ?? null;
  let sector = existing?.sector ?? null;
  let faceValue = existing?.face_value ?? null;
  let source = existing?.source ?? null;

  const { data: master } = await supabase
    .from("stock_master")
    .select("company_name, sector, face_value")
    .eq("ticker", ticker)
    .maybeSingle();
  if (master) {
    companyName = companyName ?? master.company_name ?? null;
    sector = sector ?? master.sector ?? null;
    faceValue = faceValue ?? master.face_value ?? null;
    source = source ?? "stock-master";
  }

  // Only pay for the directory request when we still lack the basics.
  if (!companyName || !sector) {
    const directory = await fetchPsxSymbols();
    const official = directory.get(ticker);
    if (official) {
      companyName = companyName ?? official.name;
      sector = sector ?? (official.sector || null);
      source = "psx-directory";
    }
  }

  const row: Partial<MetadataRow> = {
    ticker,
    company_name: companyName,
    sector,
    industry: existing?.industry ?? null,
    exchange: "PSX",
    face_value: faceValue,
    description: existing?.description ?? null,
    business_lines: existing?.business_lines ?? null,
    source,
    last_fetched_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };

  await cacheMetadata(row);
  return toMetadata(ticker, { ...(existing ?? {}), ...row } as MetadataRow, companyName ? "fresh" : "partial");
}

async function cacheMetadata(row: Partial<MetadataRow>): Promise<void> {
  if (!hasServiceRole()) return;
  try {
    const admin = createAdminClient();
    await admin.from("company_metadata").upsert(row, { onConflict: "ticker" });
  } catch {
    /* cache write is best-effort */
  }
}

/** Persist an AI-generated description + business lines (called from the refresh route). */
export async function saveCompanyDescription(
  ticker: string,
  patch: { description?: string; business_lines?: string[]; industry?: string }
): Promise<void> {
  await cacheMetadata({
    ticker: ticker.toUpperCase(),
    ...patch,
    source: "ai",
    last_updated: new Date().toISOString(),
  });
}
