/**
 * Apply ENGROH and AABS, both unblocked by refetching the CORRECT filing.
 *
 * Neither company was ever genuinely unreadable. Both were blocked by a
 * filing-selection bug, and the fix was to fetch the right document rather
 * than to read the wrong one harder:
 *
 *   ENGROH files under "Transmission of Annual Financial Statements", a
 *   spelling the matcher did not recognise (it looked only for "annual
 *   report" / "annual account"). The FY2025 annual had been on PSX since 7
 *   April 2026. The matcher fell through to the FY2024 report, and a
 *   stale-by-a-year annual is more dangerous than a missing one: nothing
 *   errors and the figures look reasonable until reconciled.
 *
 *   AABS's interim slot was taken by "Advertisement regarding Credit of
 *   Interim Dividend for the half year ended March 31, 2026" — a one-page
 *   newspaper notice that matched on "half year" and was newer than the real
 *   quarterly report filed three weeks earlier.
 *
 * ENGROH — consolidated. 46.20 (annual printed p187) + Q1'26 8.50 - Q1'25
 * restated 1.52 (interim p26) = 53.18, exact to Sarmaaya.
 *   Unconsolidated is 0.21 and is not a real earnings measure: post-Scheme
 *   the company holds only its ECL investment, so standalone results are
 *   dividend income alone, which fell from 6,666,606k to 536,620k. The
 *   unconsolidated chain is meaningless here, not merely mismatched.
 *
 *   NCI is ~48% of group profit (51,398,032k of 107,030,650k), so EPS is
 *   struck on the owners' share (55,632,618k) and the figures below follow
 *   that basis throughout.
 *
 *   NOT captured, deliberately: FY2024 comparatives sit on the OLD pre-Scheme
 *   481,287k share base while FY2025 sits on 1,204,232k, and the report does
 *   NOT mark them restated. Any year-over-year EPS comparison across that
 *   boundary is corrupted by a 2.5x denominator change. We store FY2025
 *   onward only, so the trap is avoided rather than inherited.
 *
 * AABS — unconsolidated, and that is not a preference: the company has no
 * subsidiaries and files no consolidated statements at all. FY2025 73.17
 * (annual printed p42) + H1 FY2026 21.40 - H1 FY2025 34.63 (both interim
 * printed p09) = 59.94, exact to Sarmaaya.
 *   September fiscal year end, so the March interim is a HALF YEAR, not a
 *   quarter. The filing prints cumulative AND quarter-only columns side by
 *   side (21.40 vs 10.12); taking the quarter column by mistake would give a
 *   TTM of 48.66 and look plausible. The cumulative column is the correct one.
 *
 *   npx tsx scripts/apply-refetch-batch.ts --dry
 *   npx tsx scripts/apply-refetch-batch.ts
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

const BOOKS: Record<string, { basis: "consolidated" | "unconsolidated"; rows: Row[] }> = {
  ENGROH: {
    basis: "consolidated",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-04-07", data: { eps: 46.2, profit_after_tax: 55_632_618 }, flags: ["hand_verified", "attributable_to_owners"], cite: "annual printed p187, owners 55,632,618k of 107,030,650k group" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 8.5, profit_after_tax: 10_235_731 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p26" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 1.52, profit_after_tax: 1_826_643 }, flags: ["hand_verified", "restated", "attributable_to_owners"], cite: "interim p26, restated per IAS 8" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 219_582_659 }, flags: ["hand_verified", "owners_equity"], cite: "interim p25, owners 219,582,659k ex-NCI 100,708,888k" },
    ],
  },
  AABS: {
    basis: "unconsolidated",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-01-06", data: { eps: 73.17, profit_after_tax: 1_270_362 }, flags: ["hand_verified", "no_subsidiaries"], cite: "annual printed p42, FY ended 30 Sep 2025" },
      // H1 FY2026 = CUMULATIVE six-month column, not the quarter-only 10.12
      // printed beside it. Sugar is heavily seasonal, so the two differ a lot.
      { fiscal_year: 2026, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-22", data: { eps: 21.4, profit_after_tax: 371_498 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim printed p09, six months ended 31 Mar 2026" },
      { fiscal_year: 2025, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-22", data: { eps: 34.63, profit_after_tax: 601_177 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim printed p09, six months ended 31 Mar 2025" },
      { fiscal_year: 2026, fiscal_period: "H1", statement: "balance_sheet", reported_date: "2026-05-22", data: { equity: 8_424_205 }, flags: ["hand_verified"], cite: "interim printed p08" },
    ],
  },
  // SIEM — Siemens Pakistan Engineering. Unconsolidated because there is
  // nothing to consolidate: SIEM is itself 93.03% owned by Siemens AG and
  // discloses no subsidiaries of its own, so only one set of statements
  // exists. September fiscal year end, so the March interim is a HALF YEAR.
  //
  // FY2025 100.57 (annual p40) + H1 FY2026 1.53 - H1 FY2025 70.73 (both
  // interim p6, cumulative columns) = 31.37, exact to Sarmaaya.
  //
  // TWO THINGS THAT LOOK LIKE ERRORS AND ARE NOT:
  //  1. The magnitude. Only ~8.2m shares are outstanding, so per-share figures
  //     run in the tens and hundreds. The six-year summary on p22 prints
  //     100.57, (248.34), 117.72, 203.81, 103.07, (60.14) — this is simply
  //     what this company's EPS looks like. Do not "correct" it.
  //  2. The composition. Of FY2025's 100.57, some 87.80 is DISCONTINUED
  //     operations (the Energy Business disposal). Continuing-operations EPS
  //     actually FELL, from 38.07 to 12.77. The headline is therefore not
  //     repeatable earnings, and a forward view should lean on the continuing
  //     line rather than the total.
  //
  // Comparatives are "re-presented" (reclassified to split out the
  // discontinued business), NOT restated for a prior-period error — the
  // report is explicit about the distinction on p44 note 1.3.
  SIEM: {
    basis: "unconsolidated",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-12-22", data: { eps: 100.57, profit_after_tax: 829_413 }, flags: ["hand_verified", "includes_discontinued", "no_subsidiaries"], cite: "annual p40, total 100.57 = continuing 12.77 + discontinued 87.80" },
      { fiscal_year: 2026, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-29", data: { eps: 1.53, profit_after_tax: 12_643 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim p6, six months ended 31 Mar 2026" },
      { fiscal_year: 2025, fiscal_period: "H1", statement: "income_statement", reported_date: "2026-05-29", data: { eps: 70.73, profit_after_tax: 583_323 }, flags: ["hand_verified", "cumulative_not_quarter"], cite: "interim p6, six months ended 31 Mar 2025" },
      { fiscal_year: 2026, fiscal_period: "H1", statement: "balance_sheet", reported_date: "2026-05-29", data: { equity: 6_198_836 }, flags: ["hand_verified"], cite: "interim p5" },
    ],
  },
};

// Rows that are not merely superseded but WRONG, and that the upserts below
// cannot reach because they sit under a different period key.
//
// SIEM 2026 Q3: the filing it came from is the six months ended 31 March
// 2026. SIEM's fiscal year ends 30 SEPTEMBER, so Oct-Dec is Q1 and Jan-Mar is
// Q2. A quarter labelled Q3 cannot end on 31 March for this company — the
// figure (-5.73) is really the Q2 quarter-only column. Left in place it is the
// latest-dated interim row and would be chosen ahead of the correct H1 chain,
// reproducing the same duplicate-label failure already seen on FCCL.
//
// Note this is a period MISLABEL, not a bad number: -5.73 is a real figure
// from the filing, and the correctly-labelled psx-portal Q2 2026 row already
// carries it (and reconciles: Q1 7.27 + Q2 -5.73 = 1.54 against H1 1.53).
// Includes rows this script ITSELF created on a first run. H1 and 9M periods
// are stored with period_type "cumulative", not "quarterly" — the first pass
// used "quarterly", which is a different key, so instead of correcting SIEM's
// existing wrong H1 it inserted a second one beside it and left the engine
// choosing between two contradictory rows for the same period.
const STALE_ROWS: Array<{ ticker: string; period_type?: string; fiscal_year: number; fiscal_period: string; source_type: string; basis?: string; why: string }> = [
  // Mis-typed rows from this script's own first run.
  { ticker: "SIEM", period_type: "quarterly", fiscal_year: 2026, fiscal_period: "H1", source_type: "psx-filing", why: "written by this script with period_type quarterly; H1 must be cumulative" },
  { ticker: "SIEM", period_type: "quarterly", fiscal_year: 2025, fiscal_period: "H1", source_type: "psx-filing", why: "same" },
  { ticker: "AABS", period_type: "quarterly", fiscal_year: 2026, fiscal_period: "H1", source_type: "psx-filing", why: "same" },
  { ticker: "AABS", period_type: "quarterly", fiscal_year: 2025, fiscal_period: "H1", source_type: "psx-filing", why: "same" },

  // AABS has NOT filed a Q3. Its latest accounts are the half year to 31 March
  // 2026, and this row carries that same filing's reported_date — the
  // extractor read the H1 document and labelled a figure as Q3. PSX shows only
  // a board meeting called to approve Q3, with nothing filed yet. Left in
  // place it fabricates a 9M period and drags the TTM to 35.43 against a true
  // 59.94.
  { ticker: "AABS", fiscal_year: 2026, fiscal_period: "Q3", source_type: "psx-filing", why: "no Q3 filing exists; mislabelled figure read out of the H1 document" },

  // SIEM: the extractor captured CONTINUING-operations EPS as though it were
  // the total, for a company whose result is dominated by discontinued
  // operations. FY2025 total is 100.57 of which 87.80 is discontinued, so a
  // stored 12.77 understates earnings by 8x. Same defect on FY2024 (38.07
  // stored against a true -248.34, which even flips the sign) and on the
  // interim legs. These are wrong values, not stale ones, and no upsert
  // reaches them because they sit under different basis/period keys.
  { ticker: "SIEM", period_type: "annual", fiscal_year: 2025, fiscal_period: "FY", source_type: "psx-filing", basis: "unlabelled", why: "12.77 is continuing-operations only; total is 100.57" },
  { ticker: "SIEM", period_type: "annual", fiscal_year: 2024, fiscal_period: "FY", source_type: "psx-filing", basis: "unconsolidated", why: "38.07 is continuing-only; total is -248.34, opposite sign" },
  { ticker: "SIEM", period_type: "cumulative", fiscal_year: 2025, fiscal_period: "H1", source_type: "psx-filing", why: "-17.07 is continuing-only; total is 70.73" },
  { ticker: "SIEM", period_type: "quarterly", fiscal_year: 2025, fiscal_period: "Q1", source_type: "psx-filing", why: "122.06 inconsistent with the filing's own Q1 column" },
  { ticker: "SIEM", period_type: "quarterly", fiscal_year: 2025, fiscal_period: "Q3", source_type: "psx-filing", why: "-55.66 is the continuing-operations quarter figure" },
  { ticker: "SIEM", period_type: "quarterly", fiscal_year: 2026, fiscal_period: "Q3", source_type: "psx-filing", why: "Q3 cannot end 31 Mar for a 30 Sep fiscal year; this is the Q2 column mislabelled" },
];

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const s of STALE_ROWS) {
    console.log(`${DRY ? "[dry] " : ""}DELETE ${s.ticker} ${s.fiscal_year} ${s.fiscal_period} (${s.source_type}): ${s.why}`);
    if (DRY) continue;
    let q = db
      .from("company_financials")
      .delete()
      .eq("ticker", s.ticker)
      .eq("fiscal_year", s.fiscal_year)
      .eq("fiscal_period", s.fiscal_period)
      .eq("source_type", s.source_type)
      .eq("statement_type", "income_statement");
    if (s.period_type) q = q.eq("period_type", s.period_type);
    if (s.basis) q = q.eq("reporting_basis", s.basis);
    const { error } = await q;
    if (error) console.log(`  ERROR: ${error.message}`);
  }

  for (const [ticker, book] of Object.entries(BOOKS)) {
    console.log(`\n${ticker} [${book.basis}]`);
    for (const r of book.rows) {
      const what = r.statement === "balance_sheet" ? `equity=${r.data.equity?.toLocaleString()}` : `eps=${r.data.eps}`;
      console.log(`  ${DRY ? "[dry] " : ""}${r.fiscal_year} ${r.fiscal_period} ${what}  (${r.cite})`);
      if (DRY) continue;
      const { error } = await db.from("company_financials").upsert(
        {
          ticker,
          // H1/9M are CUMULATIVE periods, not quarters. Using "quarterly" for
          // them writes to a different key than the rest of the pipeline uses,
          // so a correction lands beside the row it was meant to replace
          // instead of overwriting it.
          period_type: r.fiscal_period === "FY" ? "annual" : /^(H1|H2|9M)$/.test(r.fiscal_period) ? "cumulative" : "quarterly",
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
    console.log(`${ticker}: ${res.available}/${res.computed} ratios, P/E eps=${(pe?.inputs as { eps?: number })?.eps?.toFixed(2)} basis="${pe?.source_period}"`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
