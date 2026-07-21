/**
 * Apply SEARL's consolidated EPS chain, read by hand from the primary
 * documents (annual report + interim, both cached).
 *
 *   Annual report (filed 2025-10-07), Consolidated Statement of Profit or
 *   Loss, page 217: FY2025 loss per share -2.73 (continuing 1.54,
 *   discontinued (4.27) — the discontinued leg is a loss on divesting
 *   subsidiary Searle Pakistan Ltd).
 *
 *   That figure predates a 15% bonus issue completed during 9M FY2026
 *   (share capital note, unconsolidated interim p15: 511,494,424 ->
 *   588,218,587) and was never restated for it. The interim's OWN
 *   comparative figures ARE already restated per IAS 33, so mixing the
 *   as-published -2.73 with the restated interim legs would double-count
 *   the share dilution on one side only. Restated: -2.73 * (511494424 /
 *   588218587) = -2.3739.
 *
 *   Interim filing (filed 2026-04-30), Consolidated Statement of Profit or
 *   Loss, page 24/28: 9M 2026 EPS 3.89 (attributable-to-owners profit
 *   2,286,345 thousand), 9M 2025 comparative EPS -0.55 (attributable loss
 *   321,690 thousand).
 *
 * TTM = -2.3739 + 3.89 - (-0.55) = 2.07, within 1.5% of Sarmaaya's 2.04.
 *
 *   npx tsx scripts/apply-searl-consolidated.ts --dry
 *   npx tsx scripts/apply-searl-consolidated.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
const DRY = process.argv.includes("--dry");

const ROWS = [
  { fiscal_year: 2025, fiscal_period: "FY", eps: -2.37, profit_after_tax: -1_398_406, reported_date: "2025-10-07", page: 217 },
  { fiscal_year: 2026, fiscal_period: "9M", eps: 3.89, profit_after_tax: 2_286_345, reported_date: "2026-04-30", page: 24 },
  { fiscal_year: 2025, fiscal_period: "9M", eps: -0.55, profit_after_tax: -321_690, reported_date: "2026-04-30", page: 28 },
];

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const r of ROWS) {
    console.log(`${DRY ? "[dry] " : ""}SEARL ${r.fiscal_year} ${r.fiscal_period} [consolidated] eps=${r.eps} (page ${r.page})`);
    if (DRY) continue;
    const { error } = await db.from("company_financials").upsert(
      {
        ticker: "SEARL",
        period_type: r.fiscal_period === "FY" ? "annual" : "cumulative",
        fiscal_year: r.fiscal_year,
        fiscal_period: r.fiscal_period,
        statement_type: "income_statement",
        reporting_basis: "consolidated",
        source_type: "psx-filing",
        reported_date: r.reported_date,
        data: { eps: r.eps, _basis: "consolidated", _units: "PKR thousands", profit_after_tax: r.profit_after_tax },
        confidence: 0.85,
        review_status: "published",
        validation_flags: ["hand_verified", "share_count_restated"],
      },
      { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
    );
    if (error) console.log(`  ERROR: ${error.message}`);
  }

  if (DRY) return;

  const { refreshRatios } = await import("@/lib/engine/ratios");
  const res = await refreshRatios(db, "SEARL");
  console.log(`\nSEARL: ${res.available}/${res.computed} ratios`);

  const { data: pe } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", "SEARL").eq("ratio_name", "P/E").maybeSingle();
  console.log(`P/E now: eps=${(pe?.inputs as { eps?: number })?.eps} basis="${pe?.source_period}"`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
