/**
 * Apply JSBL's consolidated EPS chain.
 *
 * Read by a subagent directly off the cached PDFs with the Read tool. This
 * company could not be done any other way available at the time: its filings
 * are scanned/image-only (no text layer for the DeepSeek extractor) AND both
 * vision API providers were out of credits. Reading the page images in-context
 * bypasses that dependency entirely.
 *
 *   Annual report (filed 2026-03-05), consolidated profit or loss, printed
 *   page 183: FY2025 EPS 2.84. Unconsolidated, printed page 59: 1.36.
 *
 *   Interim (filed 2026-04-30), consolidated profit or loss, printed page 51:
 *   Q1 2026 EPS 0.44, Q1 2025 comparative 1.18.
 *
 * TTM = 2.84 + 0.44 - 1.18 = 2.10, exact to Sarmaaya's 2.1. The
 * unconsolidated chain (1.36 + 0.51 - 0.63 = 1.24) does not reconcile, which
 * is why this ticker joins CONSOLIDATED_BASIS_TICKERS.
 *
 * profit_after_tax below is the figure EPS is actually struck on — profit
 * attributable to owners of the Bank — NOT total consolidated PAT. FY2025
 * total PAT is 7,539,228k of which 1,712,248k belongs to non-controlling
 * interest; storing the total would imply a share count ~2.7x the real one
 * and silently corrupt P/B, which is exactly the class of error that broke
 * MUGHAL's P/B earlier.
 *
 *   npx tsx scripts/apply-jsbl-consolidated.ts --dry
 *   npx tsx scripts/apply-jsbl-consolidated.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
const DRY = process.argv.includes("--dry");

const ROWS = [
  { fiscal_year: 2025, fiscal_period: "FY", eps: 2.84, profit_after_tax: 5_826_980, reported_date: "2026-03-05", page: 183 },
  { fiscal_year: 2026, fiscal_period: "Q1", eps: 0.44, profit_after_tax: 909_339, reported_date: "2026-04-30", page: 51 },
  { fiscal_year: 2025, fiscal_period: "Q1", eps: 1.18, profit_after_tax: 2_423_896, reported_date: "2026-04-30", page: 51 },
];

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const r of ROWS) {
    console.log(`${DRY ? "[dry] " : ""}JSBL ${r.fiscal_year} ${r.fiscal_period} [consolidated] eps=${r.eps} (page ${r.page})`);
    if (DRY) continue;
    const { error } = await db.from("company_financials").upsert(
      {
        ticker: "JSBL",
        period_type: r.fiscal_period === "FY" ? "annual" : "quarterly",
        fiscal_year: r.fiscal_year,
        fiscal_period: r.fiscal_period,
        statement_type: "income_statement",
        reporting_basis: "consolidated",
        source_type: "psx-filing",
        reported_date: r.reported_date,
        data: { eps: r.eps, _basis: "consolidated", _units: "PKR thousands", profit_after_tax: r.profit_after_tax },
        confidence: 0.9,
        review_status: "published",
        validation_flags: ["hand_verified", "attributable_to_owners"],
      },
      { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
    );
    if (error) console.log(`  ERROR: ${error.message}`);
  }

  // Consolidated balance sheet, interim printed page 50. Store equity
  // ATTRIBUTABLE TO OWNERS (66,531,130) and not total equity including NCI
  // (78,803,779). Consolidated EPS is struck on profit attributable to
  // owners, so pairing the ratio's numerator with total equity would mix a
  // group-wide denominator against an owners-only numerator and overstate
  // book value by the NCI share — the same numerator/denominator mismatch
  // in a different guise.
  console.log(`${DRY ? "[dry] " : ""}JSBL 2026 Q1 [consolidated] balance_sheet equity=66,531,130 (owners, ex-NCI, page 50)`);
  if (!DRY) {
    const { error } = await db.from("company_financials").upsert(
      {
        ticker: "JSBL",
        period_type: "quarterly",
        fiscal_year: 2026,
        fiscal_period: "Q1",
        statement_type: "balance_sheet",
        reporting_basis: "consolidated",
        source_type: "psx-filing",
        reported_date: "2026-04-30",
        data: { equity: 66_531_130, _basis: "consolidated", _units: "PKR thousands" },
        confidence: 0.9,
        review_status: "published",
        validation_flags: ["hand_verified", "equity_excludes_nci"],
      },
      { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
    );
    if (error) console.log(`  ERROR: ${error.message}`);
  }

  if (DRY) return;

  const { refreshRatios } = await import("@/lib/engine/ratios");
  const res = await refreshRatios(db, "JSBL");
  console.log(`\nJSBL: ${res.available}/${res.computed} ratios`);
  const { data: pe } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", "JSBL").eq("ratio_name", "P/E").maybeSingle();
  console.log(`P/E now: eps=${(pe?.inputs as { eps?: number })?.eps} basis="${pe?.source_period}"`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
