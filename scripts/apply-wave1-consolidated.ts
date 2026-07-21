/**
 * Apply BAFL and AGP on a consolidated basis, read off the cached PDFs by
 * subagents using the Read tool (both vision API providers are out of
 * credits, and several of these filings are scanned images with no text
 * layer, so neither the DeepSeek extractor nor the app's vision path could
 * touch them).
 *
 * BAFL — Bank Alfalah. THE SHARE SPLIT IS THE WHOLE STORY HERE.
 *   The AGM of 26 March 2026 approved a 2-for-1 split, taking the share count
 *   from 1,577,165k to 3,154,330k. The FY2025 annual was published on 5 March
 *   2026, i.e. BEFORE that AGM, so its EPS of 17.62 (consolidated, annual
 *   printed p539) is struck on the PRE-split base. The Q1 2026 interim EPS of
 *   3.48 and its restated comparative 2.24 (interim printed p60) are on the
 *   POST-split base and are explicitly labelled "(Restated)".
 *
 *   Chaining 17.62 + 3.48 - 2.24 would give 18.86 and be badly wrong: it adds
 *   a full year of pre-split earnings to post-split quarters. The FY figure
 *   must be halved first. 17.62 / 2 = 8.81 is MY ARITHMETIC — the annual does
 *   not print a split-adjusted figure anywhere, so it is not a read number.
 *
 *   What makes it safe is that the adjustment is what reconciles:
 *     8.81 + 3.48 - 2.24 = 10.05, exact to Sarmaaya's 10.05.
 *   Unadjusted it would be 18.86, off by 88%. The reference independently
 *   confirms the halving.
 *
 *   Unconsolidated (17.97/2 + 3.53 - 2.23 = 10.28) lands within 2.3% of the
 *   reference, close enough to be misleading, but consolidated is exact and
 *   is therefore the basis recorded.
 *
 * AGP — AGP Limited (pharmaceuticals).
 *   Consolidated FY2025 13.34 (annual printed p320) + Q1'26 3.06 - Q1'25 3.04
 *   (both interim printed p25) = 13.36 vs Sarmaaya 13.41, a 0.4% gap.
 *   Unconsolidated (8.43 + 1.99 - 1.66 = 8.76) is nowhere near it — this
 *   company's subsidiaries carry roughly a third of group earnings, so the
 *   basis choice moves EPS by over 50%.
 *
 * Both companies' consolidated EPS is struck on profit attributable to
 * OWNERS, not total group profit. profit_after_tax and equity below follow
 * that same basis throughout, so the P/B denominator matches the numerator
 * its EPS was struck on.
 *
 *   npx tsx scripts/apply-wave1-consolidated.ts --dry
 *   npx tsx scripts/apply-wave1-consolidated.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
const DRY = process.argv.includes("--dry");

type Row = {
  fiscal_year: number;
  fiscal_period: string;
  statement: "income_statement" | "balance_sheet";
  reported_date: string;
  data: Record<string, number>;
  flags: string[];
  cite: string;
};

const BOOKS: Record<string, Row[]> = {
  BAFL: [
    // 8.81 is 17.62 halved for the 2:1 split. Flagged split_adjusted so this
    // is never mistaken for a figure printed in the annual report.
    { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-03-05", data: { eps: 8.81, profit_after_tax: 27_802_210 }, flags: ["hand_verified", "split_adjusted", "attributable_to_owners"], cite: "annual p539, EPS 17.62 pre-split halved for the 2:1 split" },
    { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 3.48, profit_after_tax: 10_986_211 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p60, post-split" },
    { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 2.24, profit_after_tax: 7_075_644 }, flags: ["hand_verified", "restated_for_split", "attributable_to_owners"], cite: "interim p60, restated post-split" },
    { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 190_658_723 }, flags: ["hand_verified", "owners_equity"], cite: "interim p61, NCI nil at this date" },
  ],
  AGP: [
    { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-03-20", data: { eps: 13.34, profit_after_tax: 3_736_178 }, flags: ["hand_verified", "attributable_to_owners"], cite: "annual printed p320" },
    { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 3.06, profit_after_tax: 857_236 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim printed p25" },
    { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 3.04, profit_after_tax: 852_545 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim printed p25" },
    { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 16_323_194 }, flags: ["hand_verified", "owners_equity"], cite: "interim p26, owners 16,323,194 ex-NCI 1,763,534" },
  ],
  // EPCL — Engro Polymer & Chemicals. A LOSS year, and the negative sign is
  // the point: consolidated -4.29 (annual printed p273) + Q1'26 0.41 -
  // Q1'25 -0.91 = -2.97, exact to Sarmaaya's -2.97. Unconsolidated
  // (-3.35 + 0.55 + 0.69 = -2.11) does not reconcile.
  //
  // BASIC, not diluted, is stored throughout. Q1 2026 returned to profit, so
  // the 3,000,000k of convertible preference shares stop being antidilutive
  // and basic/diluted diverge for the first time (0.41 basic vs 0.31 diluted
  // consolidated). Sarmaaya's -2.97 reconciles against the basic series, so
  // mixing in a diluted figure would silently break the chain.
  //
  // No NCI anywhere: all three subsidiaries are wholly owned, so consolidated
  // profit is entirely attributable to owners and equity needs no adjustment.
  //
  // Note for anyone reading the face of the FY2024 statements: EPS there is
  // struck AFTER deducting 201,000k of convertible preference dividends, so
  // the printed profit does not divide into the printed EPS. That mechanic is
  // disclosed in note 38 and is not an error.
  EPCL: [
    { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-03-12", data: { eps: -4.29, profit_after_tax: -3_898_186 }, flags: ["hand_verified", "loss_year", "basic_not_diluted"], cite: "annual printed p273" },
    { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 0.41, profit_after_tax: 370_841 }, flags: ["hand_verified", "basic_not_diluted"], cite: "interim p6, basic (diluted 0.31)" },
    { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -0.91, profit_after_tax: -824_591 }, flags: ["hand_verified", "loss_period", "basic_not_diluted"], cite: "interim p6" },
    // 20,770,045 = total consolidated equity 23,770,045 (interim p5) LESS the
    // 3,000,000 of convertible preference share capital. Book value per
    // ORDINARY share must exclude preference capital, since the denominator
    // (908,923k shares) counts ordinary shares only.
    //
    // This was not guesswork. Storing the full 23,770,045 gave P/B 1.25
    // against Sarmaaya's 1.43 — a 12.5% gap that could NOT be price vintage,
    // because P/E agreed to 0.2% and both ratios share the same price.
    // Inverting Sarmaaya's P/B implied equity of ~20.8bn, which is the total
    // less preference capital to within rounding. Ex-preference gives P/B
    // 1.43 exactly.
    { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 20_770_045 }, flags: ["hand_verified", "no_nci", "excludes_preference_capital"], cite: "interim p5, 23,770,045 total less 3,000,000 preference" },
  ],
};

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const [ticker, rows] of Object.entries(BOOKS)) {
    console.log(`\n${ticker}`);
    for (const r of rows) {
      const what = r.statement === "balance_sheet" ? `equity=${r.data.equity?.toLocaleString()}` : `eps=${r.data.eps}`;
      console.log(`  ${DRY ? "[dry] " : ""}${r.fiscal_year} ${r.fiscal_period} ${what}  (${r.cite})`);
      if (DRY) continue;
      const { error } = await db.from("company_financials").upsert(
        {
          ticker,
          period_type: r.fiscal_period === "FY" ? "annual" : "quarterly",
          fiscal_year: r.fiscal_year,
          fiscal_period: r.fiscal_period,
          statement_type: r.statement,
          reporting_basis: "consolidated",
          source_type: "psx-filing",
          reported_date: r.reported_date,
          data: { ...r.data, _basis: "consolidated", _units: "PKR thousands" },
          confidence: 0.9,
          review_status: "published",
          validation_flags: r.flags,
        },
        { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
      );
      if (error) console.log(`    ERROR: ${error.message}`);
    }
  }

  if (DRY) return;

  const { refreshRatios } = await import("@/lib/engine/ratios");
  console.log("");
  for (const ticker of Object.keys(BOOKS)) {
    const res = await refreshRatios(db, ticker);
    const { data: pe } = await db.from("company_ratios").select("inputs").eq("ticker", ticker).eq("ratio_name", "P/E").maybeSingle();
    console.log(`${ticker}: ${res.available}/${res.computed} ratios, P/E eps=${(pe?.inputs as { eps?: number })?.eps?.toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
