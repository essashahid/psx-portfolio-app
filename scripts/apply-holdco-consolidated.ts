/**
 * Flip five holding companies to a CONSOLIDATED basis.
 *
 * These five were demoted to _needsRecheck when the drift gate found them
 * disagreeing with the reference. Re-reading every filing established that
 * NONE of them was a data error. Every chain reproduces to the paisa on BOTH
 * bases; the entire discrepancy was that the engine served standalone while
 * the reference quotes the group:
 *
 *              unconsolidated (what we served)   consolidated (reference)
 *   MCB        45.73 + 10.80 - 11.65 = 44.88     49.29 + 11.07 - 12.36 = 48.00
 *   LUCK       22.59 + 25.07 - 18.67 = 28.99     52.53 + 43.47 - 39.12 = 56.88
 *   FFC        51.69 + 12.14 -  9.33 = 54.50     58.44 + 13.62 - 12.23 = 59.83
 *   HUBC       14.71 + 18.44 - 14.31 = 18.84     35.56 + 25.49 - 26.40 = 34.65
 *   FATIMA     14.51 +  1.99 -  3.84 = 12.66     20.03 +  1.54 -  3.99 = 17.58
 *
 * The basis was a policy decision, not a correction, and it was taken
 * deliberately: standalone accounts hide subsidiary and associate earnings,
 * which for these structures is most of the business.
 *   - HUBC standalone profit is 19.1bn against group owners' 46.1bn, with
 *     41.3bn of associate and JV income that reaches the standalone accounts
 *     only as 14.9bn of dividends.
 *   - FATIMA carved its Multan Plant out into a wholly owned subsidiary
 *     effective 1 Jan 2025, so the standalone entity is now only the
 *     Sadiqabad Plant and its series is not comparable to its own history.
 *   - FFC's two bases move in OPPOSITE directions year on year (standalone
 *     45.49 -> 51.69 rising, consolidated 59.29 -> 58.44 falling), so any
 *     growth statement flips sign with the basis.
 *
 * EVERY consolidated EPS below is struck on profit attributable to OWNERS,
 * verified BY DIVISION rather than by trusting each filing's note wording —
 * a filing earlier in this project claimed owners' basis while its printed
 * EPS only divided out from the total. FATIMA is the one exception, and only
 * because its subsidiaries are wholly owned so the two coincide; it prints no
 * NCI line at all.
 *
 * UNITS: PKR thousands throughout.
 *
 *   npx tsx scripts/apply-holdco-consolidated.ts --dry
 *   npx tsx scripts/apply-holdco-consolidated.ts
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

const BOOKS: Record<string, { note: string; rows: Row[] }> = {
  // Bank. Owners 58,415,056 of 58,775,408 group; NCI 360,352.
  // Division check: 58,415,056 / 1,185,060,006 = 49.293 -> printed 49.29.
  // Total basis would give 49.60 and does not match.
  MCB: {
    note: "MCB Bank",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-03-06", data: { eps: 49.29, profit_after_tax: 58_415_056 }, flags: ["hand_verified", "attributable_to_owners", "verified_by_division"], cite: "annual p461, note 37" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 11.07, profit_after_tax: 13_112_803 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p25, note 36" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 12.36, profit_after_tax: 14_651_519 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p25, note 36" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 315_875_580 }, flags: ["hand_verified", "owners_equity"], cite: "interim p25, owners ex-NCI 756,828" },
    ],
  },

  // Cement + holding. NCI is large (7.5bn of 84.5bn group profit in FY25).
  // Division check: 76,956,147 / 1,465,000 = 52.53 -> matches. Total would
  // give 57.68 and does not.
  // NOTE the 5-for-1 share split approved 18 Mar 2025: all prior-period EPS
  // in both filings is ALREADY retrospectively restated per IAS 33, so these
  // legs mix no pre-split and post-split figures.
  LUCK: {
    note: "Lucky Cement",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-09-05", data: { eps: 52.53, profit_after_tax: 76_956_147 }, flags: ["hand_verified", "attributable_to_owners", "verified_by_division", "post_split_restated"], cite: "annual p292, note 37" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 43.47, profit_after_tax: 63_686_406 }, flags: ["hand_verified", "attributable_to_owners", "cumulative_not_quarter"], cite: "interim p32 (quarter-only column is 13.02)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 39.12, profit_after_tax: 57_313_557 }, flags: ["hand_verified", "attributable_to_owners", "cumulative_not_quarter"], cite: "interim p32" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 403_618_144 }, flags: ["hand_verified", "owners_equity"], cite: "interim p31, owners ex-NCI 42,772,244" },
    ],
  },

  // Fertiliser. Owners 83,170,819 of 84,946,307; NCI 1,775,488.
  // Division check: 83,170,819 / 1,423,109 = 58.44 -> matches; total 59.69 does not.
  // No balance-sheet row: the consolidated statements print no owners'-equity
  // subtotal, only total-including-NCI, and deriving one would be arithmetic
  // rather than a read figure. P/B therefore stays on whatever the engine
  // already holds rather than being fabricated here.
  FFC: {
    note: "Fauji Fertilizer",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-02-23", data: { eps: 58.44, profit_after_tax: 83_170_819 }, flags: ["hand_verified", "attributable_to_owners", "verified_by_division"], cite: "annual p430, note 37" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 13.62, profit_after_tax: 19_594_902 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p32" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 12.23, profit_after_tax: 17_400_809 }, flags: ["hand_verified", "attributable_to_owners"], cite: "interim p32" },
    ],
  },

  // Power holding. The extreme case: associate and JV income of 41.3bn sits
  // entirely outside the standalone accounts, which see 14.9bn of dividends.
  // Division check: 46,131,156 / 1,297,154,387 = 35.56 -> matches; total
  // including NCI would give 39.91 and does not.
  HUBC: {
    note: "Hub Power",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2025-09-19", data: { eps: 35.56, profit_after_tax: 46_131_156 }, flags: ["hand_verified", "attributable_to_owners", "verified_by_division", "includes_discontinued"], cite: "annual p277, note 42.1; total 35.56 = continuing 35.44 + discontinued 0.12" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-27", data: { eps: 25.49, profit_after_tax: 33_063_292 }, flags: ["hand_verified", "attributable_to_owners", "cumulative_not_quarter", "read_from_page_images"], cite: "interim p27 (quarter-only column is 8.33)" },
      { fiscal_year: 2025, fiscal_period: "9M", statement: "income_statement", reported_date: "2026-04-27", data: { eps: 26.4, profit_after_tax: 34_248_623 }, flags: ["hand_verified", "attributable_to_owners", "cumulative_not_quarter", "read_from_page_images"], cite: "interim p27; total 26.40 = continuing 27.04 + discontinued -0.64" },
      { fiscal_year: 2026, fiscal_period: "9M", statement: "balance_sheet", reported_date: "2026-04-27", data: { equity: 226_303_472 }, flags: ["hand_verified", "owners_equity", "read_from_page_images"], cite: "interim p29, owners ex-NCI 20,688,308" },
    ],
  },

  // Fertiliser. The ONLY one here where owners' and total profit coincide,
  // because every subsidiary is wholly owned and no NCI line appears anywhere
  // in the consolidated statements. Division check: 42,059,025 / 2,100,000 =
  // 20.028 -> printed 20.03.
  // Its annual carries TWO complete note sets with different numbering (EPS is
  // note 41 separate, note 40 consolidated), and an unlabelled scraper reading
  // "the EPS note" takes whichever prints first — the separate set. That is
  // plausibly how the standalone 12.66 got wired in originally.
  FATIMA: {
    note: "Fatima Fertilizer",
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", statement: "income_statement", reported_date: "2026-03-27", data: { eps: 20.03, profit_after_tax: 42_059_025 }, flags: ["hand_verified", "no_nci", "verified_by_division"], cite: "annual printed p270, note 40 (consolidated set)" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 1.54, profit_after_tax: 3_236_455 }, flags: ["hand_verified", "no_nci"], cite: "interim printed p30, note 20" },
      { fiscal_year: 2025, fiscal_period: "Q1", statement: "income_statement", reported_date: "2026-04-30", data: { eps: 3.99, profit_after_tax: 8_374_587 }, flags: ["hand_verified", "no_nci"], cite: "interim printed p30; consolidated comparative NOT restated (the Multan carveout is intra-group)" },
      { fiscal_year: 2026, fiscal_period: "Q1", statement: "balance_sheet", reported_date: "2026-04-30", data: { equity: 173_100_998 }, flags: ["hand_verified", "no_nci"], cite: "interim printed p28" },
    ],
  },
};

const periodType = (p: string) => (p === "FY" ? "annual" : /^(H1|H2|9M)$/.test(p) ? "cumulative" : "quarterly");

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const [ticker, book] of Object.entries(BOOKS)) {
    console.log(`\n${ticker} [consolidated] — ${book.note}`);
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
    const { data: pe } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", ticker).eq("ratio_name", "P/E").maybeSingle();
    console.log(`${ticker.padEnd(7)} ${res.available}/${res.computed} ratios, eps=${(pe?.inputs as { eps?: number })?.eps?.toFixed(2)} (${pe?.source_period})`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
