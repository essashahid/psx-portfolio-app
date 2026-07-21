/**
 * Wave 2 batch 1: seven companies read off their filings by subagents and
 * reconciled against Sarmaaya. Each was read WITHOUT being told the reference
 * figure, so agreement is an independent check rather than a target.
 *
 *   PKGS  consolidated   -9.43  exact
 *   JSCL  consolidated    6.02  exact
 *   TPL   consolidated  -10.61  exact
 *   ZTL   unconsolidated -0.82  exact
 *   PINL  unconsolidated  3.86  vs 3.89
 *   EFUL  unconsolidated 20.86  vs 20.91
 *   ADAMS unconsolidated  8.78  vs 9.29 — see the note on its entry
 *
 * UNITS: every figure below is PKR THOUSANDS. TPL, ZTL and ADAMS print their
 * statements in whole rupees rather than thousands, so their figures are
 * converted here. Getting this wrong would not change EPS but WOULD change
 * the implied share count (profit / EPS) by 1000x and destroy P/B.
 *
 * PKGS CARRIES A TRAP FOR ANY TEXT-LAYER EXTRACTOR. Its interim PDF has a
 * stale hidden text layer over the consolidated statements: pdftotext returns
 * a phantom column reading 10.61 basic / (5.13) prior, where the RENDERED
 * PAGE shows 7.73 / (3.39). The phantom figures are internally self-consistent
 * (they carry a matching phantom profit of 948,158), so an arithmetic sanity
 * check does not catch them. The values below were read from the page images.
 * Anything re-extracting PKGS from the text layer will silently disagree.
 *
 *   npx tsx scripts/apply-wave2a.ts --dry
 *   npx tsx scripts/apply-wave2a.ts
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
  // Holding company: standalone revenue is dividend and rental income only
  // (5.87bn) against consolidated revenue of 193.2bn, so unconsolidated EPS of
  // 34.17 is dividend-upstreaming and would badly misrepresent the group.
  // Headline oddity that is NOT an error: the group made a PROFIT of 260,587
  // yet reports a LOSS per share of (20.55), because the whole profit and more
  // accrued to non-controlling interests (2,096,893) while owners absorbed
  // (1,836,306). EPS is struck on the owners' portion.
  PKGS: {
    basis: "consolidated",
    note: "Packages Limited",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-04-09", data: { eps: -20.55, profit_after_tax: -1_836_306 }, flags: ["hand_verified", "attributable_to_owners", "read_from_page_images"], cite: "annual printed p185" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 7.73, profit_after_tax: 690_661 }, flags: ["hand_verified", "attributable_to_owners", "read_from_page_images"], cite: "interim printed p27 (text layer falsely says 10.61)" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -3.39, profit_after_tax: -302_733 }, flags: ["hand_verified", "attributable_to_owners", "read_from_page_images"], cite: "interim printed p27 (text layer falsely says -5.13)" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 66_270_101 }, flags: ["hand_verified", "owners_equity"], cite: "interim printed p27, owners ex-NCI 19,420,527" },
    ],
  },

  // Investment holding company. Unconsolidated profit 326,498 against
  // consolidated 10,391,006 — a ~32x gap, because standalone income is
  // essentially dividends from related parties. NCI takes 38% of FY2025 group
  // profit and 55% of Q1 FY2026, so the owners-only numerator matters.
  JSCL: {
    basis: "consolidated",
    note: "Jahangir Siddiqui & Co",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-04-02", data: { eps: 7.08, profit_after_tax: 6_480_825 }, flags: ["hand_verified", "attributable_to_owners"], cite: "annual report p335, note 44" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 0.71, profit_after_tax: 653_258 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p31, note 13" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 1.77, profit_after_tax: 1_621_188 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p31" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 58_370_289 }, flags: ["hand_verified", "owners_equity"], cite: "interim p30, owners ex-NCI 35,497,252" },
    ],
  },

  // June fiscal year end, so the March interim is the NINE MONTH period.
  // Deeply loss-making on both bases. NCI absorbs the MAJORITY of group losses
  // and its share is growing (35% of FY2025, 57% of 9M FY2026), so the
  // owners-only numerator is essential. Owners' consolidated equity went
  // NEGATIVE at 31 Mar 2026 (-2,123,697k), which is why Sarmaaya's own P/B for
  // this name is negative (-1.08) — that is real, not a data fault.
  // Figures converted from whole rupees to thousands.
  TPL: {
    basis: "consolidated",
    note: "TPL Corp",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-12-09", data: { eps: -8.32, profit_after_tax: -2_224_188 }, flags: ["hand_verified", "attributable_to_owners", "loss_year"], cite: "annual printed p158 note 44 (face says -8.3, note says -8.32)" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -9.52, profit_after_tax: -2_544_336 }, flags: ["hand_verified", "attributable_to_owners", "loss_period"], cite: "interim printed p26" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -7.23, profit_after_tax: -1_931_656 }, flags: ["hand_verified", "attributable_to_owners", "loss_period"], cite: "interim printed p26" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: -2_123_697 }, flags: ["hand_verified", "owners_equity", "negative_equity"], cite: "interim p25, owners NEGATIVE, NCI +2,210,987" },
    ],
  },

  // Premier Insurance. NOT a bulk terminal or Pioneer — the ticker label used
  // when commissioning the read was wrong, and the reading agent corrected it
  // from the statements' own legal-status note.
  PINL: {
    basis: "unconsolidated",
    note: "Premier Insurance",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-04-06", data: { eps: 2.43, profit_after_tax: 122_666 }, flags: ["hand_verified", "no_subsidiaries"], cite: "annual printed p34, note 36" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-05-04", data: { eps: 1.87, profit_after_tax: 94_754 }, flags: ["hand_verified"], cite: "interim printed p07, note 28" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-05-04", data: { eps: 0.44, profit_after_tax: 22_202 }, flags: ["hand_verified"], cite: "interim printed p07" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-05-04", data: { equity: 1_100_388 }, flags: ["hand_verified"], cite: "interim printed p06" },
    ],
  },

  // Life assurance. EPS sits on the AGGREGATE statement, which the company
  // itself notes is shareholders'-fund profit PLUS surplus transferred from
  // the statutory funds PLUS undistributed statutory-fund surplus. No
  // shareholders'-fund-only profit is printed anywhere, so the aggregate is
  // the only available basis and is what the company strikes EPS on.
  // No consolidated statements: EFU Health was merged by amalgamation into
  // EFUL in 2024, so there is no subsidiary left to consolidate.
  // FY2024 comparatives are restated (the 2024 acquisition was booked at
  // provisional fair values, finalised and applied retrospectively per IFRS 3).
  EFUL: {
    basis: "unconsolidated",
    note: "EFU Life Assurance",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-03-09", data: { eps: 23.26, profit_after_tax: 2_442_123 }, flags: ["hand_verified", "aggregate_statutory_funds", "read_from_page_images"], cite: "annual printed p347, note 40" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 3.76, profit_after_tax: 394_792 }, flags: ["hand_verified", "aggregate_statutory_funds"], cite: "interim printed p07" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 6.16, profit_after_tax: 638_890 }, flags: ["hand_verified", "restated", "aggregate_statutory_funds"], cite: "interim printed p07, marked Restated" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 9_383_703 }, flags: ["hand_verified"], cite: "interim printed p06" },
    ],
  },

  // Zephyr Textiles (NOT "Z-Tech"; corrected by the reading agent from the
  // cover). June fiscal year end, so the March interim is the NINE MONTH
  // period. Figures converted from whole rupees to thousands.
  // The FY2025 EPS of 0.03 is genuinely that small — PAT was 1,819k on sales
  // of 8.28bn — so the implied share count from profit/EPS carries meaningful
  // rounding error at two decimals. The balance sheet, not that division, is
  // the reliable source for equity.
  // The 9M FY2026 loss is driven by a 70.32m levy charge, not operations:
  // operating profit stayed positive at 184.05m, and Q3 in isolation was
  // profitable at 0.12 against a 9M figure of -0.67.
  ZTL: {
    basis: "unconsolidated",
    note: "Zephyr Textiles",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-06", data: { eps: 0.03, profit_after_tax: 1_819 }, flags: ["hand_verified", "read_from_page_images"], cite: "annual printed p31, note 45" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -0.67, profit_after_tax: -39_971 }, flags: ["hand_verified", "loss_period", "read_from_page_images"], cite: "interim printed p05" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 0.18, profit_after_tax: 10_472 }, flags: ["hand_verified", "read_from_page_images"], cite: "interim printed p05" },
      // Balance sheet, NOT the statement of changes in equity: the SOCIE omits
      // a 39,000k "Contribution from sponsor" column and is exactly that much
      // lower. The balance sheet is the statement that foots.
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 2_490_246 }, flags: ["hand_verified", "balance_sheet_not_socie"], cite: "interim printed p04" },
    ],
  },

  // Sugar, September fiscal year end, so the March interim is a HALF YEAR.
  // Highly seasonal: the 127-day crushing season (15 Nov - 21 Mar) falls
  // almost entirely inside H1, so H1 is NOT half a year and annualising it
  // would be wrong.
  //
  // THE REFERENCE DISAGREES AND WE ARE THE ONES WHO ARE RIGHT. Our chain gives
  // 8.78; Sarmaaya says 9.29. The 0.51 gap is EXACTLY the restatement the
  // company made: H1 FY2025 EPS was restated from (2.54) as previously
  // reported to (2.03), for a deferred-tax rate error (interim note 24).
  // Chaining the SUPERSEDED comparative gives 2.67 + 4.08 + 2.54 = 9.29,
  // reproducing Sarmaaya exactly. So the reference is carrying stale
  // pre-restatement data and we are using the corrected figure, as IAS 8
  // requires. Recorded at a lower confidence tier because the usual
  // independent check does not agree, but the disagreement is fully explained
  // rather than merely tolerated.
  ADAMS: {
    basis: "unconsolidated",
    note: "Adam Sugar Mills",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-01-06", data: { eps: 2.67, profit_after_tax: 46_134 }, flags: ["hand_verified", "no_subsidiaries"], cite: "annual p11, note 33" },
      { fiscal_year: 2026, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-25", data: { eps: 4.08, profit_after_tax: 70_536 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim p6, six months (quarter-only column is 1.23)" },
      { fiscal_year: 2025, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-25", data: { eps: -2.03, profit_after_tax: -35_064 }, flags: ["hand_verified", "restated", "supersedes_-2.54"], cite: "interim p6, RESTATED from -2.54 per note 24" },
      { fiscal_year: 2026, fiscal_period: "H1", statement: "balance_sheet", reported_date: "2026-05-25", data: { equity: 5_098_889 }, flags: ["hand_verified"], cite: "interim p5" },
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
    console.log(`${ticker.padEnd(7)} ${res.available}/${res.computed} ratios, eps=${(pe?.inputs as { eps?: number })?.eps?.toFixed(2)} (${pe?.source_period})`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
