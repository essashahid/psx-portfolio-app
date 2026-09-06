import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeHoldingsFromTransactions } from "@/lib/portfolio/positions";
import type { HoldingQuickAddRequest, HoldingQuickAddResponse } from "@psx/shared/api/holdings";

/** A rejection the caller can show as it is. Kept here so this module stays free of Next imports and testable in Jest. */
export class QuickAddError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "QuickAddError";
  }
}

/**
 * Record a position someone already owns, from onboarding.
 *
 * Two paths, chosen by whether the average cost is known:
 *
 * - Known: a BUY dated today goes into the ledger and the holding is derived
 *   by recomputeHoldingsFromTransactions, the same way every other trade is.
 *   The portfolio model stays one model.
 * - Unknown: the holding is written directly, source "manual", with zero cost.
 *   The columns are NOT NULL, so zero stands in for "not known"; isCostUnknown
 *   in positions.ts reads the pair (manual, zero) back as unknown and every
 *   surface prints "Cost unknown" rather than a zero gain. A later BUY for the
 *   same ticker replaces the row through the recompute upsert.
 *
 * The ticker must be a known PSX company: stock_master first, stock_universe
 * as the fallback, because the search box draws from both.
 */
export async function quickAddHolding(
  supabase: SupabaseClient,
  userId: string,
  input: HoldingQuickAddRequest
): Promise<HoldingQuickAddResponse> {
  const ticker = input.ticker.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(ticker)) throw new QuickAddError("Enter a valid PSX ticker.");
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new QuickAddError("Number of shares must be above zero.");
  const avgCost = input.avgCost === null || input.avgCost === undefined ? null : Number(input.avgCost);
  if (avgCost !== null && (!Number.isFinite(avgCost) || avgCost <= 0)) {
    throw new QuickAddError("Average cost must be above zero, or leave it blank.");
  }

  const company = await lookupCompany(supabase, ticker);
  if (!company) throw new QuickAddError(`${ticker} is not a listed PSX company we know.`);

  if (avgCost !== null) {
    const tradeDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    const { error } = await supabase.from("transactions").insert({
      user_id: userId,
      ticker,
      trade_date: tradeDate,
      type: "BUY",
      quantity,
      price: avgCost,
      commission: null,
      tax: null,
      net_amount: null,
      source: "manual",
      notes: "Added during onboarding",
      row_hash: `onboarding-${userId}-${ticker}-${tradeDate}-${quantity}-${avgCost}-${Date.now()}`,
    });
    if (error) throw error;
    await recomputeHoldingsFromTransactions(supabase, userId);
    return { ok: true, ticker, path: "ledger" };
  }

  const { error } = await supabase.from("holdings").upsert(
    {
      user_id: userId,
      ticker,
      company_name: company.company_name,
      sector: company.sector,
      quantity,
      avg_cost: 0,
      total_cost: 0,
      source: "manual",
      hidden: false,
      last_updated: new Date().toISOString(),
    },
    { onConflict: "user_id,ticker" }
  );
  if (error) throw error;
  return { ok: true, ticker, path: "manual" };
}

async function lookupCompany(
  supabase: SupabaseClient,
  ticker: string
): Promise<{ company_name: string | null; sector: string | null } | null> {
  const master = await supabase.from("stock_master").select("ticker, company_name, sector").eq("ticker", ticker).maybeSingle();
  if (master.error) throw master.error;
  if (master.data) return { company_name: master.data.company_name ?? null, sector: master.data.sector ?? null };
  const universe = await supabase.from("stock_universe").select("ticker, company_name, sector").eq("ticker", ticker).maybeSingle();
  if (universe.error) throw universe.error;
  if (universe.data) return { company_name: universe.data.company_name ?? null, sector: universe.data.sector ?? null };
  return null;
}
