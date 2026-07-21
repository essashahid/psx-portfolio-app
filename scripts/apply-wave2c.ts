/**
 * Wave 2 batch 3: five companies read off their filings by subagents and
 * reconciled against Sarmaaya. Read WITHOUT being told the reference figure.
 *
 *   ELCM  unconsolidated -24.15  exact
 *   JLICL unconsolidated  24.05  exact
 *   JSML  unconsolidated   5.90  vs 5.89
 *   DADX  unconsolidated -30.00  vs -30.29
 *   TPLP  consolidated    -8.32  vs -8.27
 *
 * UNITS ARE THE MAIN HAZARD IN THIS BATCH. Every figure below is PKR
 * THOUSANDS, but the source documents are inconsistent:
 *   - ELCM, DADX(annual), TPLP print whole rupees; converted here.
 *   - JSML prints its ANNUAL in whole rupees and its INTERIM in thousands.
 *     Its own reading agent flagged this explicitly. Mixing the two scales
 *     within one company would leave EPS untouched while moving the implied
 *     share count (profit / EPS) by 1000x, silently destroying P/B.
 *
 *   npx tsx scripts/apply-wave2c.ts --dry
 *   npx tsx scripts/apply-wave2c.ts
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

const BOOKS: Record<string, { basis: "consolidated" | "unconsolidated"; note: string; rows: Row[] }> = {
  // Elahi Cotton Mills. 30 June year end, so the March interim is the NINE
  // MONTH period. No subsidiaries. Only 1,300,000 shares outstanding, so
  // per-share figures run in the tens of rupees — that is the share base.
  // Going-concern material uncertainty: at 30 Jun 2025 current liabilities
  // exceeded current assets by 49.4m and accumulated losses exceeded paid-up
  // capital by 45.7m.
  // Figures converted from whole rupees to thousands.
  ELCM: {
    basis: "unconsolidated",
    note: "Elahi Cotton Mills",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-02", data: { eps: 8.15, profit_after_tax: 10_592 }, flags: ["hand_verified", "no_subsidiaries", "going_concern_uncertainty", "read_from_page_images"], cite: "annual PDF p27, note 32" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: -19.11, profit_after_tax: -24_848 }, flags: ["hand_verified", "loss_period", "cumulative_not_quarter", "read_from_page_images"], cite: "interim PDF p5 (quarter-only column is -4.67)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: 13.19, profit_after_tax: 17_142 }, flags: ["hand_verified", "cumulative_not_quarter", "read_from_page_images"], cite: "interim PDF p5" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-29", data: { equity: 67_828 }, flags: ["hand_verified", "read_from_page_images"], cite: "interim PDF p4" },
    ],
  },

  // Jubilee Life Insurance. LIFE ASSURER, so the same structural caveat as
  // EFUL applies: EPS sits on the aggregate PROFIT OR LOSS ACCOUNT, which the
  // company's own note beneath the statement defines as shareholders'-fund
  // profit before tax PLUS surplus transferred from the statutory funds
  // (2,370m in FY2025) PLUS undistributed statutory-fund surplus including
  // solvency margins. A shareholders'-fund-only profit after tax is NOT
  // printed anywhere, so the aggregate is the only available basis and is the
  // one the company strikes EPS on — confirmed by division (2,495,503 /
  // 100,354 = 24.87).
  //
  // Seven statutory funds, three of them Family Takaful, all included within
  // the primary statements; the separately annexed Window Takaful Operations
  // set is supplementary and unaudited, not a second basis.
  // No consolidated statements: the only investment of that type is an
  // associate carried at equity.
  JLICL: {
    basis: "unconsolidated",
    note: "Jubilee Life Insurance",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-03-09", data: { eps: 24.87, profit_after_tax: 2_495_503 }, flags: ["hand_verified", "aggregate_statutory_funds", "no_subsidiaries"], cite: "annual printed p234, note 36" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 3.1, profit_after_tax: 311_122 }, flags: ["hand_verified", "aggregate_statutory_funds"], cite: "interim printed p12, note 22" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 3.92, profit_after_tax: 393_549 }, flags: ["hand_verified", "aggregate_statutory_funds"], cite: "interim printed p12, note 22" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 17_299_358 }, flags: ["hand_verified"], cite: "interim printed p11" },
    ],
  },

  // Jauharabad Sugar Mills (formerly Kohinoor Sugar). 30 SEPTEMBER year end,
  // so the March interim is a HALF YEAR. Profitable in every period read,
  // against the batch expectation for sugar.
  //
  // SCALE TRAP: the annual is printed in WHOLE RUPEES and the interim in
  // THOUSANDS. Both converted to thousands below.
  //
  // Note that "Loan from sponsors" (1,345,636k at FY2025) is presented WITHIN
  // the equity block, so total equity as printed includes it. Recorded as the
  // filing presents it.
  JSML: {
    basis: "unconsolidated",
    note: "Jauharabad Sugar Mills",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-01-06", data: { eps: 7.33, profit_after_tax: 250_012 }, flags: ["hand_verified", "no_subsidiaries"], cite: "annual printed p152, note 35.1; annual is in whole rupees" },
      { fiscal_year: 2026, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-29", data: { eps: 2.09, profit_after_tax: 71_172 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim printed p16 (quarter-only column is 1.01); interim is in thousands" },
      { fiscal_year: 2025, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-29", data: { eps: 3.52, profit_after_tax: 120_033 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim printed p16" },
      { fiscal_year: 2026, fiscal_period: "H1", statement: "balance_sheet", reported_date: "2026-05-29", data: { equity: 10_576_161 }, flags: ["hand_verified", "includes_sponsor_loan"], cite: "interim printed p15; equity block includes loan from sponsors" },
    ],
  },

  // Dadex Eternit. 30 June year end, so the March interim is the NINE MONTH
  // period. Itself a subsidiary of Sikander (Private) Limited and holds no
  // subsidiaries, so unconsolidated is the only basis. Small share base
  // (10.76m shares), which is why per-share losses run to double digits.
  // Going-concern material uncertainty: Manghopir factory closed since March
  // 2021, accumulated losses 1,495.8m, current liabilities exceed current
  // assets by 135.8m, head office building under contract for sale.
  // Annual converted from whole rupees; interim already in thousands.
  DADX: {
    basis: "unconsolidated",
    note: "Dadex Eternit",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-09", data: { eps: -37.82, profit_after_tax: -407_047 }, flags: ["hand_verified", "loss_year", "no_subsidiaries", "going_concern_uncertainty", "read_from_page_images"], cite: "annual printed p66, note 41" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -16.32, profit_after_tax: -175_625 }, flags: ["hand_verified", "loss_period", "cumulative_not_quarter"], cite: "interim p6, note 17 (quarter-only column is -4.61)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -24.14, profit_after_tax: -259_834 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim p6, note 17" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 259_179 }, flags: ["hand_verified"], cite: "interim p5" },
    ],
  },

  // TPL Properties. 30 June year end, so the March interim is the NINE MONTH
  // period. Consolidated -8.32 vs -8.27; unconsolidated -7.54 does not
  // reconcile.
  //
  // CONSOLIDATED EPS IS STRUCK ON TOTAL GROUP LOSS INCLUDING NCI, not on the
  // owners' share — the OPPOSITE of PKGS, JSCL, BAFL and most others in this
  // registry. The reading agent established this by division rather than by
  // trusting a note: 1,934,269,169 / 561,086,879 = 3.4473 matches the printed
  // -3.45, while the owners' 1,920,742,169 would give -3.42 and does not.
  // Same result on the interim legs. profit_after_tax and equity below
  // therefore both use the TOTAL-including-NCI basis so numerator and
  // denominator stay consistent.
  //
  // Losses are driven by unrealised marks on the TPL REIT Fund I investment
  // (-639m in FY2025, -4,102m in 9M FY2026), not by operations.
  // Figures converted from whole rupees to thousands.
  TPLP: {
    basis: "consolidated",
    note: "TPL Properties",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-12-08", data: { eps: -3.45, profit_after_tax: -1_934_269 }, flags: ["hand_verified", "loss_year", "total_incl_nci", "verified_by_division"], cite: "annual printed p104, note 34; EPS on TOTAL incl NCI, not owners" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -8.37, profit_after_tax: -4_696_044 }, flags: ["hand_verified", "loss_period", "cumulative_not_quarter", "total_incl_nci"], cite: "interim printed p29 (quarter-only column is -3.35)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -3.5, profit_after_tax: -1_966_251 }, flags: ["hand_verified", "cumulative_not_quarter", "total_incl_nci"], cite: "interim printed p29" },
      // TOTAL equity including NCI, to match the EPS basis above.
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 2_936_796 }, flags: ["hand_verified", "total_incl_nci"], cite: "interim printed p29; owners 2,947,845 + NCI -11,048" },
    ],
  },

  // Masood Textile Mills. 30 June year end, so the March interim is the NINE
  // MONTH period. 15.05 vs 15.06.
  //
  // EPS IS STRUCK AFTER DEDUCTING THE CUMULATIVE PREFERENCE DIVIDEND, which
  // is why profit_after_tax below is NOT the profit printed on the face of
  // the statement. The company has 67,500,000 ordinary shares AND 27,500,000
  // cumulative non-voting preference shares; the annual's note 36 prints the
  // arithmetic explicitly: FY2025 profit 131,279 less preference dividend
  // 50,003 = 81,276, which is the EPS numerator.
  //   - FY2025's 81,276 is a READ figure from note 36.
  //   - The interim prints no EPS note, so its numerators are DERIVED as
  //     EPS x 67,500 ordinary shares. Storing the face profit (603,462)
  //     against an EPS of 8.54 would imply 70,663k shares instead of the true
  //     67,500k and put P/B out by ~5%.
  //
  // SOURCE FILE IS TRUNCATED. The cached annual.pdf arrived byte-truncated
  // and null-padded with no PDF trailer, and re-fetching reproduces it, so
  // PSX is serving a broken document rather than this being a transient
  // download fault. The reading agent recovered 119 pages via PyMuPDF and
  // every figure reconciles, but a stricter parser will fail on this file.
  MSOT: {
    basis: "unconsolidated",
    note: "Masood Textile Mills",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-07", data: { eps: 1.2, profit_after_tax: 81_276 }, flags: ["hand_verified", "net_of_preference_dividend", "basic_not_diluted", "truncated_source_pdf", "read_from_page_images"], cite: "annual printed p93 note 36: 131,279 less pref div 50,003 = 81,276" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 8.54, profit_after_tax: 576_450 }, flags: ["hand_verified", "net_of_preference_dividend", "derived_numerator", "cumulative_not_quarter", "read_from_page_images"], cite: "interim printed p11 (quarter-only column is 2.78); numerator derived as 8.54 x 67,500k ordinary" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -5.31, profit_after_tax: -358_425 }, flags: ["hand_verified", "net_of_preference_dividend", "derived_numerator", "cumulative_not_quarter", "read_from_page_images"], cite: "interim printed p11; OCR misread this as -8.31, the rendered image and directors' report both say -5.31" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 17_692_790 }, flags: ["hand_verified", "read_from_page_images"], cite: "interim printed p9" },
    ],
  },
};

const periodType = (p: string) => (p === "FY" ? "annual" : /^(H1|H2|9M)$/.test(p) ? "cumulative" : "quarterly");

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const [ticker, book] of Object.entries(BOOKS)) {
    console.log(`\n${ticker} [${book.basis}] — ${book.note}`);
    for (const r of book.rows) {
      const what = r.statement === "balance_sheet" ? `equity=${r.data.equity?.toLocaleString()}` : `eps=${r.data.eps}`;
      console.log(`  ${DRY ? "[dry] " : ""}${r.fiscal_year} ${r.fiscal_period.padEnd(2)} ${what}`);
      if (DRY) continue;
      const { error } = await db.from("company_financials").upsert(
        {
          ticker,
          period_type: periodType(r.fiscal_period),
          fiscal_year: r.fiscal_year,
          fiscal_period: r.fiscal_period,
          statement_type: r.statement,
          reporting_basis: book.basis,
          source_type: "psx-filing",
          reported_date: r.reported_date,
          data: { ...r.data, _basis: book.basis, _units: "PKR thousands" },
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
    const { data: pe } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", ticker).eq("ratio_name", "P/E").maybeSingle();
    console.log(`${ticker.padEnd(6)} ${res.available}/${res.computed} ratios, eps=${(pe?.inputs as { eps?: number })?.eps?.toFixed(2)} (${pe?.source_period})`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
