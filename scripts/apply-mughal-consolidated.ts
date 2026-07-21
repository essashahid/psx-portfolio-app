/**
 * Apply MUGHAL's consolidated EPS chain, read directly from the primary
 * documents (not agent-proposed — the agent's earlier reads on this ticker
 * never found a complete chain; this was read by hand from the cached PDFs).
 *
 *   Annual report (filed 2025-10-06), Consolidated Statement of Profit or
 *   Loss, page 153: FY2025 EPS 2.50 (FY2024 comparative 5.68).
 *
 *   Interim filing (filed 2026-04-30), Directors' Review, page 3:
 *   "consolidated profit for the nine months period stood at Rs. 1,881.276
 *   million... EPS of Rs. 5.10 per share... as compared to ... Rs. 1.23 per
 *   share in the corresponding period" — 9M 2026 5.10, 9M 2025 (comparative)
 *   1.23.
 *
 * TTM = 2.50 + 5.10 - 1.23 = 6.37, exact to Sarmaaya's 6.37.
 *
 *   npx tsx scripts/apply-mughal-consolidated.ts --dry
 *   npx tsx scripts/apply-mughal-consolidated.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
const DRY = process.argv.includes("--dry");

// profit_after_tax stored in PKR THOUSANDS, matching the schema convention
// confirmed by MUGHAL's own pre-existing balance-sheet row (equity: 30715692
// representing Rs 30.7 billion) — NOT the full-rupee figures the filing
// itself prints. Getting this wrong doesn't just mislabel one field: PAT
// feeds sharesOutstanding = (pat*1000)/eps, so a full-rupees PAT here
// inflated the implied share count ~1000x and silently broke P/B (885
// instead of ~0.9) even though EPS/P/E were completely unaffected (P/E only
// ever touches eps, which is a genuine per-share value, never scaled).
const ROWS = [
  { fiscal_year: 2025, fiscal_period: "FY", eps: 2.5, profit_after_tax: 852_225, reported_date: "2025-10-06", page: 153 },
  { fiscal_year: 2026, fiscal_period: "9M", eps: 5.1, profit_after_tax: 1_881_276, reported_date: "2026-04-30", page: 3 },
  { fiscal_year: 2025, fiscal_period: "9M", eps: 1.23, reported_date: "2026-04-30", page: 3 },
];

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const r of ROWS) {
    console.log(`${DRY ? "[dry] " : ""}MUGHAL ${r.fiscal_year} ${r.fiscal_period} [consolidated] eps=${r.eps} (page ${r.page})`);
    if (DRY) continue;
    const { error } = await db.from("company_financials").upsert(
      {
        ticker: "MUGHAL",
        period_type: r.fiscal_period === "FY" ? "annual" : "cumulative",
        fiscal_year: r.fiscal_year,
        fiscal_period: r.fiscal_period,
        statement_type: "income_statement",
        reporting_basis: "consolidated",
        source_type: "psx-filing",
        reported_date: r.reported_date,
        data: { eps: r.eps, _basis: "consolidated", _units: "PKR thousands", ...("profit_after_tax" in r ? { profit_after_tax: r.profit_after_tax } : {}) },
        confidence: 0.9,
        review_status: "published",
        validation_flags: ["hand_verified"],
      },
      { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
    );
    if (error) console.log(`  ERROR: ${error.message}`);
  }

  if (DRY) return;

  const { refreshRatios } = await import("@/lib/engine/ratios");
  const res = await refreshRatios(db, "MUGHAL");
  console.log(`\nMUGHAL: ${res.available}/${res.computed} ratios`);

  const { data: pe } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", "MUGHAL").eq("ratio_name", "P/E").maybeSingle();
  console.log(`P/E now: eps=${(pe?.inputs as { eps?: number })?.eps} basis="${pe?.source_period}"`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
