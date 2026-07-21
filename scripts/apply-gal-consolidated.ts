/**
 * Apply GAL's consolidated EPS chain, read by hand from the primary
 * documents (both PDFs exceeded the vision provider's combined payload
 * limit -- 26.7MB annual + 1.8MB interim triggered an HTTP 413 -- so this
 * was never going to clear through the agent path regardless of retries).
 *
 *   Annual report (filed 2025-10-03), Consolidated Statement of Profit or
 *   Loss, page 133: FY2025 EPS 71.85 (2024: 6.40).
 *
 *   Interim filing (filed 2026-04-27), Consolidated Statement of Profit or
 *   Loss, page 5 (Directors' Review summary, matching the full statement at
 *   p23-24): 9M 2026 EPS 85.28, 9M 2025 comparative EPS 39.89.
 *
 * TTM = 71.85 + 85.28 - 39.89 = 117.24, exact to Sarmaaya's 117.24. No
 * share-count restatement needed (unlike SEARL) -- paid-up capital
 * unchanged at 570,025 thousand / Rs10 face value = 57,002,500 shares,
 * matching Sarmaaya's 57,000,000 almost exactly, no bonus/rights issue in
 * either filing.
 *
 *   npx tsx scripts/apply-gal-consolidated.ts --dry
 *   npx tsx scripts/apply-gal-consolidated.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
const DRY = process.argv.includes("--dry");

const ROWS = [
  { fiscal_year: 2025, fiscal_period: "FY", eps: 71.85, profit_after_tax: 4_095_590, reported_date: "2025-10-03", page: 133 },
  { fiscal_year: 2026, fiscal_period: "9M", eps: 85.28, profit_after_tax: 4_861_210, reported_date: "2026-04-27", page: 5 },
  { fiscal_year: 2025, fiscal_period: "9M", eps: 39.89, profit_after_tax: 2_274_002, reported_date: "2026-04-27", page: 5 },
];

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const r of ROWS) {
    console.log(`${DRY ? "[dry] " : ""}GAL ${r.fiscal_year} ${r.fiscal_period} [consolidated] eps=${r.eps} (page ${r.page})`);
    if (DRY) continue;
    const { error } = await db.from("company_financials").upsert(
      {
        ticker: "GAL",
        period_type: r.fiscal_period === "FY" ? "annual" : "cumulative",
        fiscal_year: r.fiscal_year,
        fiscal_period: r.fiscal_period,
        statement_type: "income_statement",
        reporting_basis: "consolidated",
        source_type: "psx-filing",
        reported_date: r.reported_date,
        data: { eps: r.eps, _basis: "consolidated", _units: "PKR thousands", profit_after_tax: r.profit_after_tax },
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
  const res = await refreshRatios(db, "GAL");
  console.log(`\nGAL: ${res.available}/${res.computed} ratios`);

  const { data: pe } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", "GAL").eq("ratio_name", "P/E").maybeSingle();
  console.log(`P/E now: eps=${(pe?.inputs as { eps?: number })?.eps} basis="${pe?.source_period}"`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
