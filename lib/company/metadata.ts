import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasCompleteIdentity, resolveCompanyIdentity } from "@/lib/company/identity";
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
 * cheap fields (name, sector, face value) from stock_universe, stock_master,
 * and the official PSX symbol directory, then caches the result. The expensive
 * The longer profile is generated separately from exchange reference data so
 * the page shell never waits on it and never needs an LLM for identity copy.
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
  const cachedRow = cached as MetadataRow | null;
  if (
    cachedRow &&
    !isStaleOrMissing(freshness) &&
    hasCompleteIdentity(cachedRow.company_name, cachedRow.sector)
  ) {
    return toMetadata(t, cachedRow, freshness);
  }

  // Refresh cheap fields. Never throw — a flaky upstream must not break the page.
  try {
    const fresh = await buildBaseMetadata(supabase, t, cachedRow);
    if (fresh?.companyName) return fresh;
  } catch {
    /* fall through */
  }

  try {
    const identity = await resolveCompanyIdentity(supabase, t);
    if (hasCompleteIdentity(identity.companyName, identity.sector)) {
      const merged = {
        ...(cachedRow ?? { ticker: t }),
        ticker: t,
        company_name: identity.companyName,
        sector: identity.sector,
        source: identity.source ?? cachedRow?.source ?? null,
      } as MetadataRow;
      return toMetadata(t, merged, "fresh");
    }
  } catch {
    /* fall through to whatever we already had */
  }

  return toMetadata(t, cachedRow ?? null, cached ? "stale" : "missing");
}

async function buildBaseMetadata(
  supabase: SupabaseClient,
  ticker: string,
  existing: MetadataRow | null
): Promise<CompanyMetadata | null> {
  let faceValue = existing?.face_value ?? null;

  const { data: master } = await supabase
    .from("stock_master")
    .select("face_value")
    .eq("ticker", ticker)
    .maybeSingle();
  if (master?.face_value != null) {
    faceValue = faceValue ?? master.face_value;
  }

  const identity = await resolveCompanyIdentity(supabase, ticker);
  const companyName = existing?.company_name?.trim() ? existing.company_name : identity.companyName;
  const sector = existing?.sector?.trim() ? existing.sector : identity.sector;
  const source = identity.source ?? existing?.source ?? null;

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
  const freshness: Freshness = hasCompleteIdentity(companyName, sector) ? "fresh" : "partial";
  return toMetadata(ticker, { ...(existing ?? {}), ...row } as MetadataRow, freshness);
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

/** Persist a generated description + business lines (called from refresh/scripts). */
export async function saveCompanyDescription(
  ticker: string,
  patch: { description?: string; business_lines?: string[]; industry?: string; website?: string | null; source?: string; source_url?: string | null; confidence?: number }
): Promise<void> {
  await cacheMetadata({
    ticker: ticker.toUpperCase(),
    ...patch,
    source: patch.source ?? "exchange-profile",
    source_url: patch.source_url,
    confidence: patch.confidence ?? 0.9,
    last_updated: new Date().toISOString(),
  });
}
