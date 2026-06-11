import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { populateFinancials, extractFinancials } from "@/lib/engine/financials";
import { populatePayouts } from "@/lib/market/payouts";
import { refreshRatios } from "@/lib/engine/ratios";

/**
 * Fundamentals orchestration for the screener/cockpit. Two tiers so a
 * universe-wide backfill can run the cheap tier broadly and the expensive tier
 * narrowly:
 *
 *  - CHEAP (no LLM): PSX company-page summary (multi-year sales / EPS / margins)
 *    + official payout history (dividend DPS) + ratio recompute. Covers ~13 of
 *    the 18 ratios for every company at near-zero cost.
 *  - DEEP (LLM, cached per filing): full statement extraction from the official
 *    filings — operating profit, finance cost, balance sheet, cash flow — which
 *    unlocks the remaining margin / leverage / liquidity / coverage / FCF
 *    ratios. Run on a small rotating slice; cached so it is a one-time cost per
 *    filing.
 *
 * Cheap runs first so the deep extraction's richer statement rows overwrite the
 * overlapping periods, while the page's extra prior years remain for growth.
 */

export interface FundamentalsResult {
  ticker: string;
  pagePeriods: number;
  payouts: number;
  extracted: number;
  ratios: { computed: number; available: number } | null;
  errors: string[];
}

export async function populateCheapFundamentals(ticker: string, client?: SupabaseClient): Promise<FundamentalsResult> {
  const t = ticker.toUpperCase();
  const db = client ?? createAdminClient();
  const out: FundamentalsResult = { ticker: t, pagePeriods: 0, payouts: 0, extracted: 0, ratios: null, errors: [] };

  const page = await populateFinancials(t).catch((e) => { out.errors.push(`page: ${e instanceof Error ? e.message : e}`); return null; });
  if (page) out.pagePeriods = page.saved;

  const pay = await populatePayouts(t, db).catch((e) => { out.errors.push(`payouts: ${e instanceof Error ? e.message : e}`); return null; });
  if (pay) { out.payouts = pay.saved; out.errors.push(...pay.errors); }

  out.ratios = await refreshRatios(db, t).catch(() => null);
  return out;
}

export async function populateDeepFundamentals(ticker: string, maxFilings = 3, client?: SupabaseClient): Promise<FundamentalsResult> {
  const t = ticker.toUpperCase();
  const db = client ?? createAdminClient();
  const out: FundamentalsResult = { ticker: t, pagePeriods: 0, payouts: 0, extracted: 0, ratios: null, errors: [] };

  const ext = await extractFinancials(t, maxFilings).catch((e) => { out.errors.push(`extract: ${e instanceof Error ? e.message : e}`); return null; });
  if (ext) { out.extracted = ext.saved; out.errors.push(...ext.errors.slice(0, 3)); }

  out.ratios = await refreshRatios(db, t).catch(() => null);
  return out;
}

/** Full pass for one ticker (cheap + deep + ratios) — used by manual/on-demand. */
export async function populateAllFundamentals(ticker: string, opts: { maxFilings?: number; client?: SupabaseClient } = {}): Promise<FundamentalsResult> {
  const t = ticker.toUpperCase();
  const db = opts.client ?? createAdminClient();
  const cheap = await populateCheapFundamentals(t, db);
  const deep = await populateDeepFundamentals(t, opts.maxFilings ?? 3, db);
  return {
    ticker: t,
    pagePeriods: cheap.pagePeriods,
    payouts: cheap.payouts,
    extracted: deep.extracted,
    ratios: deep.ratios ?? cheap.ratios,
    errors: [...cheap.errors, ...deep.errors],
  };
}
