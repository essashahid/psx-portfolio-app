/**
 * Wave 2 batch 2: five companies read off their filings by subagents and
 * reconciled against Sarmaaya. Read WITHOUT being told the reference figure,
 * so agreement is an independent check rather than a target.
 *
 *   STCL  unconsolidated  -4.03  exact
 *   AWTX  unconsolidated   9.84  exact
 *   GATI  consolidated   -10.66  vs -10.67
 *   FCEL  unconsolidated  0.965  vs 0.97
 *   AKDHL unconsolidated   0.76  vs 0.75
 *
 * ALL FIVE have a 30 JUNE fiscal year end, so their 31 March interims are
 * NINE MONTH cumulative periods, not first quarters. Every one of these
 * filings also prints a quarter-only column beside the cumulative one, and in
 * several cases the two carry opposite signs — AWTX's 9M is -27.68 while its
 * prior-year Q3 alone is +73.79, and KHTC (not applied here) swings from a
 * -34.57 nine-month loss to a +68.63 quarter. Picking the wrong column would
 * produce a plausible-looking figure that is simply a different period.
 *
 * UNITS: every figure below is PKR THOUSANDS. AKDHL, AWTX and FCEL print
 * their statements in whole rupees, so those are converted. This does not
 * change EPS but it changes the implied share count (profit / EPS) by 1000x
 * and would destroy P/B.
 *
 * NOT APPLIED, and why — recorded so the same ground is not re-covered:
 *   WAVES  reference is exactly 1.00 against our 0.49 unconsolidated / 1.91
 *          consolidated. Neither is close, and a reference of exactly 1 is
 *          suspicious in itself. Separately, WAVES' consolidated EPS note
 *          CLAIMS to use profit attributable to owners but the printed EPS
 *          only reconciles against TOTAL profit including NCI (530,460 /
 *          281,406 = 1.89; owners' 436,596 would give 1.55). The filing
 *          contradicts itself, so even the basis is unsettled.
 *   KHTC   -56.33 against a -32.24 reference, no combination of the printed
 *          columns reproduces the reference.
 *   PMRS   consolidated -317.10 against -300.03, a 5.7% gap. The basis is
 *          clearly consolidated (unconsolidated is -119.20, nowhere near) but
 *          5.7% is outside tolerance and nothing explains it.
 *   FDPL   0.030 against 0.07. Its own filing is internally inconsistent:
 *          face-of-P&L EPS 0.043 vs note-37 EPS 0.0429, and a note-37 FY2024
 *          numerator that does not equal the face PAT.
 *
 *   npx tsx scripts/apply-wave2b.ts --dry
 *   npx tsx scripts/apply-wave2b.ts
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
  // Shabbir Tiles and Ceramics. No subsidiary, so unconsolidated is the only
  // basis. Deteriorating sharply: the 9M FY2026 loss of 906,275k is nearly 7x
  // the prior year's 133,987k, equity has fallen from 2,648,775k to
  // 1,742,500k in nine months, and unappropriated profit has flipped to an
  // accumulated loss of 381,315k.
  STCL: {
    basis: "unconsolidated",
    note: "Shabbir Tiles and Ceramics",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-09-29", data: { eps: -0.8, profit_after_tax: -192_131 }, flags: ["hand_verified", "loss_year", "no_subsidiaries", "read_from_page_images"], cite: "annual PDF p47, note 37" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -3.79, profit_after_tax: -906_275 }, flags: ["hand_verified", "loss_period", "cumulative_not_quarter", "read_from_page_images"], cite: "interim printed p9 (quarter-only column is -1.45)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -0.56, profit_after_tax: -133_987 }, flags: ["hand_verified", "cumulative_not_quarter", "read_from_page_images"], cite: "interim printed p9" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 1_742_500 }, flags: ["hand_verified", "read_from_page_images"], cite: "interim printed p8" },
    ],
  },

  // Allawasaya Textile and Finishing Mills. Only 800,000 shares outstanding,
  // so per-share figures run in the tens and hundreds — that is the share
  // base, not a scaling error. FY2024/FY2023 comparatives are labelled
  // "(Restated)" in the annual but NO restatement note explains why; the
  // reading agent checked notes 3, 4, 45, 46 and 47 and declined to infer a
  // cause. The restatement did not touch the share base, so the chain holds.
  // Figures converted from whole rupees to thousands.
  AWTX: {
    basis: "unconsolidated",
    note: "Allawasaya Textile",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-06", data: { eps: -87.29, profit_after_tax: -69_831 }, flags: ["hand_verified", "loss_year", "no_subsidiaries", "read_from_page_images"], cite: "annual printed p33, note 36" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: -27.68, profit_after_tax: -22_147 }, flags: ["hand_verified", "cumulative_not_quarter", "read_from_page_images"], cite: "interim printed p5 (quarter-only column is -32.86)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: -124.81, profit_after_tax: -99_846 }, flags: ["hand_verified", "cumulative_not_quarter", "read_from_page_images"], cite: "interim printed p5 (quarter-only column is +73.79, opposite sign)" },
      // Shareholders' equity ONLY. The balance sheet adds a separate "Loan
      // from directors 192,500,000" line below equity to reach 1,477,718,500;
      // that subtotal is not shareholders' equity and must not be used.
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-29", data: { equity: 1_263_072 }, flags: ["hand_verified", "excludes_director_loan", "read_from_page_images"], cite: "interim printed p4" },
    ],
  },

  // Gatron (Industries). Consolidated -10.66 vs -10.67; unconsolidated -8.72
  // does not reconcile. All three subsidiaries are WHOLLY owned, so there is
  // no NCI and consolidated profit is entirely attributable to owners — the
  // owners-vs-total distinction that mattered for PKGS and JSCL is moot here.
  // The consolidated loss exceeds the unconsolidated loss in every period.
  //
  // WATCH: a Scheme of Arrangement with Nova Frontiers and Ghani & Tayub was
  // board-resolved 28 Jan 2026 and would cancel a 29.33% and a 2.98% holding
  // and issue new shares at a swap ratio not yet determined. The share count
  // is unchanged at 31 Mar 2026, but this WILL move the base once effective
  // and will break the chain when it does.
  GATI: {
    basis: "consolidated",
    note: "Gatron Industries",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-23", data: { eps: -18.53, profit_after_tax: -2_014_681 }, flags: ["hand_verified", "loss_year", "no_nci", "read_from_page_images"], cite: "annual printed p127, note 40" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -9.25, profit_after_tax: -1_005_955 }, flags: ["hand_verified", "cumulative_not_quarter", "no_nci", "read_from_page_images"], cite: "interim PDF p30 (quarter-only column is -1.88)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: -17.12, profit_after_tax: -1_860_918 }, flags: ["hand_verified", "cumulative_not_quarter", "no_nci", "read_from_page_images"], cite: "interim PDF p30" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 11_837_414 }, flags: ["hand_verified", "no_nci", "read_from_page_images"], cite: "interim PDF p29" },
    ],
  },

  // First Capital Equities. Itself a 73.23%-owned subsidiary of First Capital
  // Securities, and holds no subsidiaries of its own, so it files
  // unconsolidated only.
  //
  // EPS IS SPLIT continuing vs discontinued and the TOTAL is stored: FY2025
  // continuing 1.210, discontinued -0.003, total 1.207. The discontinued
  // operation is the brokerage business, being wound down since the 2019
  // decision to surrender the PSX Trading Right Entitlement Certificate and
  // convert the company to real estate. Storing the continuing line instead
  // would repeat the exact error found in SIEM's stored data.
  //
  // Carries a QUALIFIED audit opinion and a going-concern material
  // uncertainty. Figures converted from whole rupees to thousands.
  FCEL: {
    basis: "unconsolidated",
    note: "First Capital Equities",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-10", data: { eps: 1.207, profit_after_tax: 170_914 }, flags: ["hand_verified", "total_incl_discontinued", "qualified_opinion", "read_from_page_images"], cite: "annual PDF p38, total 1.207 = continuing 1.210 + discontinued -0.003" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: 0.06, profit_after_tax: 8_494 }, flags: ["hand_verified", "cumulative_not_quarter", "total_incl_discontinued", "read_from_page_images"], cite: "interim PDF p6 (quarter-only column is -0.6614, opposite sign)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: 0.302, profit_after_tax: 42_723 }, flags: ["hand_verified", "cumulative_not_quarter", "total_incl_discontinued", "read_from_page_images"], cite: "interim PDF p6" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-29", data: { equity: 531_972 }, flags: ["hand_verified", "read_from_page_images"], cite: "interim PDF p5" },
    ],
  },

  // AKD Hospitality. Despite the ticker it is NOT a holding company and files
  // no consolidated accounts; the auditor's report covers the Company alone.
  // Effectively dormant in its stated line of business: revenue is a flat
  // 6,000k a year of retainer income billed to a single related party, and
  // the auditors note operations "at reasonable scale in its principal line
  // of business are at halt since long". Carries a going-concern material
  // uncertainty. Its high P/B (reference 16.18) follows from a tiny 37,891k
  // equity base, not from a data fault.
  // Figures converted from whole rupees to thousands.
  AKDHL: {
    basis: "unconsolidated",
    note: "AKD Hospitality",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-07", data: { eps: 0.51, profit_after_tax: 1_266 }, flags: ["hand_verified", "no_subsidiaries", "going_concern_uncertainty", "read_from_page_images"], cite: "annual PDF p89, note 24" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 0.95, profit_after_tax: 2_373 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim PDF p7, note 14 (quarter-only column is 0.10)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 0.7, profit_after_tax: 1_754 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim PDF p7, note 14" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 37_891 }, flags: ["hand_verified"], cite: "interim PDF p8" },
    ],
  },

  // First Capital Securities. Parent of FCEL (also in this batch), so the two
  // are related but reconcile independently. Consolidated 3.243 vs 3.24;
  // unconsolidated 4.90 does not reconcile.
  //
  // THE INTERIM PRINTS NO TOTAL EPS LINE on the consolidated basis — only
  // continued and discontinued rows. The 9M totals below are therefore
  // DERIVED, computed as owners' profit over the 316,610,112 share base
  // rather than read off a page: 65,127,216 / 316,610,112 = 0.2057 and
  // -194,387,373 / 316,610,112 = -0.6140. Using the face's rounded 0.21
  // instead would give 0.2086 and drift the chain. The exact reconciliation
  // to 3.24 is what validates the derivation.
  //
  // EPS is struck on the OWNERS' portion: FY2025 owners 767,330,930 of
  // 868,872,805 group total, with 101,541,875 to NCI. Confirmed by the
  // filing's own note 36 numerators.
  //
  // Discontinued operations here are the stock-broking business of subsidiary
  // FCEL, whose PSX Trading Right Entitlement Certificate was surrendered in
  // 2019 — the same wind-down that appears inside FCEL's own filing.
  //
  // COMPARABILITY CAVEAT: the group acquired 56.86% of Pace Supermall during
  // the period (previously 0.07%), so consolidated revenue and cost
  // comparatives are not like-for-like. The share base is unaffected, so the
  // EPS chain itself holds.
  // Figures converted from whole rupees to thousands.
  FCSC: {
    basis: "consolidated",
    note: "First Capital Securities",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-10-10", data: { eps: 2.4236, profit_after_tax: 767_331 }, flags: ["hand_verified", "attributable_to_owners", "total_incl_discontinued", "read_from_page_images"], cite: "annual PDF p99, note 36; total 2.4236 = continued 2.4246 + discontinued -0.0010" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: 0.2057, profit_after_tax: 65_127 }, flags: ["hand_verified", "attributable_to_owners", "derived_total_no_line_printed", "cumulative_not_quarter"], cite: "interim PDF p16/p24; derived from owners' profit, no total EPS line printed" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-29", data: { eps: -0.614, profit_after_tax: -194_387 }, flags: ["hand_verified", "attributable_to_owners", "derived_total_no_line_printed", "cumulative_not_quarter"], cite: "interim PDF p16/p24; derived, no total EPS line printed" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-29", data: { equity: 2_223_058 }, flags: ["hand_verified", "owners_equity", "read_from_page_images"], cite: "interim PDF p15, owners ex-NCI 767,943,077" },
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
    console.log(`${ticker.padEnd(6)} ${res.available}/${res.computed} ratios, eps=${(pe?.inputs as { eps?: number })?.eps?.toFixed(3)} (${pe?.source_period})`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
