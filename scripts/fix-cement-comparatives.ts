/**
 * Hand-read corrections for the remaining unverified Cement names.
 *
 * Every figure below was read directly off the 9M FY2026 filing (quarter ended
 * March 31, 2026) for each company. This file is the audit trail: the numbers
 * are transcribed, not derived, and the notes record why each row was wrong.
 *
 * The recurring failure is the same one already fixed for ACPL, DGKC and MLCF:
 * the prior-year interim comparative is either missing or was fabricated by
 * copying the current year's quarters, which breaks the trailing-12m EPS
 * (annual + current interim - prior-year same interim).
 *
 *   npx tsx scripts/fix-cement-comparatives.ts          # dry run
 *   npx tsx scripts/fix-cement-comparatives.ts --apply
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

type Row = {
  ticker: string;
  fiscal_year: number;
  fiscal_period: string;
  period_type: string;
  data: Record<string, number>;
  note: string;
};

/** New or corrected statements, transcribed from the filings. */
const UPSERTS: Row[] = [
  {
    ticker: "GWLC",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "9M FY2025 comparative was missing entirely. Restores TTM EPS 6.75 (Sarmaaya 6.74).",
    data: {
      revenue: 14_770_122,
      cost_of_sales: 12_036_586,
      gross_profit: 2_733_536,
      profit_before_tax: 2_069_881,
      profit_after_tax: 1_257_601,
      eps: 3.14,
    },
  },
  {
    ticker: "THCCL",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "9M FY2025 comparative was missing. Filing restates it to EPS 3.98 on the post-split base.",
    data: {
      revenue: 5_621_114,
      cost_of_sales: 3_995_611,
      gross_profit: 1_625_503,
      profit_before_tax: 2_416_061,
      profit_after_tax: 1_687_519,
      eps: 3.98,
    },
  },
  {
    ticker: "POWER",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "9M FY2025 was absent and the quarterly rows had been copied from FY2026. Real EPS is 0.07, not the 1.47 those duplicates implied. Restores TTM EPS 2.28 (Sarmaaya 2.24).",
    data: {
      revenue: 21_004_306,
      cost_of_sales: 15_205_451,
      gross_profit: 5_798_855,
      profit_before_tax: 698_500,
      profit_after_tax: 347_927,
      eps: 0.07,
    },
  },
  {
    ticker: "FECTC",
    fiscal_year: 2026,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "No 9M FY2026 row existed at all; only H1 plus a separate Q3. EPS 12.23 = stored H1 11.77 + Q3 0.47.",
    data: {
      revenue: 9_589_386,
      cost_of_sales: 8_538_600,
      gross_profit: 1_050_786,
      profit_before_tax: 789_899,
      profit_after_tax: 613_594,
      eps: 12.23,
    },
  },
  {
    ticker: "FECTC",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "9M FY2025 comparative was missing. Filing marks this column 'Restated'.",
    data: {
      revenue: 8_143_805,
      cost_of_sales: 6_782_137,
      gross_profit: 1_361_668,
      profit_before_tax: 799_656,
      profit_after_tax: 481_535,
      eps: 9.60,
    },
  },
  {
    ticker: "DCL",
    fiscal_year: 2026,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "No 9M FY2026 row existed. Loss-making; EPS -1.05 ties to the stored quarters (-0.82, -0.44, +0.21).",
    data: {
      revenue: 18_225_608,
      cost_of_sales: 17_146_014,
      gross_profit: 1_079_595,
      profit_before_tax: -361_783,
      profit_after_tax: -507_997,
      eps: -1.05,
    },
  },
  {
    ticker: "DCL",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "9M FY2025 comparative was missing. Restores TTM EPS -2.37, matching Sarmaaya exactly.",
    data: {
      revenue: 15_726_730,
      cost_of_sales: 14_833_133,
      gross_profit: 893_597,
      profit_before_tax: -258_491,
      profit_after_tax: -328_238,
      eps: -0.68,
    },
  },
  {
    ticker: "DNCC",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "9M FY2025 comparative was missing. Restores TTM EPS -0.39, matching Sarmaaya exactly.",
    data: {
      revenue: 4_492_135,
      cost_of_sales: 4_115_821,
      gross_profit: 376_314,
      profit_before_tax: -207_283,
      profit_after_tax: -99_314,
      eps: -0.31,
    },
  },
  {
    ticker: "SMCPL",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    note: "9M FY2025 comparative was missing. Filed in full rupees, converted to thousands to match our convention.",
    data: {
      revenue: 1_120_246,
      cost_of_sales: 959_148,
      gross_profit: 161_097,
      profit_before_tax: 81_583,
      profit_after_tax: 52_917,
      eps: 2.12,
    },
  },
];

/**
 * EPS restated for a share split. THCCL moved from Rs 10 to Rs 2 face value:
 * share capital is unchanged at Rs 847,181k across both balance sheet dates,
 * while the filing's own 9M FY2026 EPS of 4.48 on a PAT of Rs 1,898,344k
 * implies 423.6M shares (847,181 / 2), not the 84.7M a Rs 10 par would give.
 * The filing confirms it by restating 9M FY2025 from an implied 19.92 to 3.98,
 * a factor of 5.005. Our stored FY2025 figures still sit on the old base.
 */
const EPS_RESTATEMENTS: { ticker: string; fiscal_year: number; fiscal_period: string; eps: number; note: string }[] = [
  {
    ticker: "THCCL",
    fiscal_year: 2025,
    fiscal_period: "FY",
    eps: 6.04,
    note: "5:1 split (Rs 10 -> Rs 2 par). PAT 2,556,691k / 423.59M shares = 6.04, was 30.18 on the pre-split base.",
  },
  {
    ticker: "THCCL",
    fiscal_year: 2025,
    fiscal_period: "Q3",
    eps: 1.32,
    note: "Same split. Filing reports Q3 FY2025 EPS 1.32; stored 6.61 is the pre-split figure (1.32 x 5).",
  },
];

/**
 * Rows contradicted by the filing. Quarantined rather than deleted so the bad
 * data stays inspectable; needs_review excludes them from the ratio engine.
 */
const QUARANTINE: { ticker: string; fiscal_year: number; fiscal_period: string; note: string }[] = [
  { ticker: "POWER", fiscal_year: 2025, fiscal_period: "H1", note: "PAT 1,661,407k exceeds the filing's full 9M FY2025 PAT of 347,927k. Fabricated." },
  { ticker: "POWER", fiscal_year: 2025, fiscal_period: "Q1", note: "Byte-identical to 2026 Q1 (eps 0.60, revenue 7,814,354k). Copied forward." },
  { ticker: "POWER", fiscal_year: 2025, fiscal_period: "Q2", note: "Byte-identical to 2026 Q2 (eps 0.65, revenue 8,645,780k). Copied forward." },
  { ticker: "FECTC", fiscal_year: 2025, fiscal_period: "Q1", note: "Revenue of 880k against a company doing ~3bn a quarter, eps 0. Junk extraction." },
  { ticker: "DCL", fiscal_year: 2025, fiscal_period: "Q1", note: "eps +0.82 on revenue 5,590,963k, sign-flipped duplicate of 2026 Q1 (-0.82, same revenue)." },
  { ticker: "DCL", fiscal_year: 2025, fiscal_period: "H1", note: "eps -1.26 is byte-identical to 2025 Q2. Filing implies H1 FY2025 of -0.62 (9M -0.68 less Q3 -0.06)." },
  { ticker: "SMCPL", fiscal_year: 2025, fiscal_period: "Q1", note: "eps 1.87 on revenue 596,282k duplicates 2026 Q1 (1.87 on 596,292k)." },
];

const APPLY = process.argv.includes("--apply");

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  console.log(APPLY ? "APPLYING corrections\n" : "DRY RUN (pass --apply to write)\n");

  for (const row of UPSERTS) {
    const label = `${row.ticker} ${row.fiscal_year} ${row.fiscal_period}`;
    const { data: existing } = await db
      .from("company_financials")
      .select("id, data")
      .eq("ticker", row.ticker)
      .eq("fiscal_year", row.fiscal_year)
      .eq("fiscal_period", row.fiscal_period)
      .eq("statement_type", "income_statement")
      .eq("source_type", "psx-filing")
      .eq("reporting_basis", "unconsolidated")
      .maybeSingle();

    console.log(`${existing ? "update" : "insert"}  ${label}  eps=${row.data.eps}`);
    console.log(`         ${row.note}`);
    if (!APPLY) continue;

    const { error } = await db.from("company_financials").upsert(
      {
        ticker: row.ticker,
        period_type: row.period_type,
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
        statement_type: "income_statement",
        reporting_basis: "unconsolidated",
        source_type: "psx-filing",
        data: row.data,
        confidence: 1,
        review_status: "published",
        validation_flags: ["hand_read"],
      },
      { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
    );
    if (error) console.log(`         ERROR: ${error.message}`);
  }

  for (const fix of EPS_RESTATEMENTS) {
    const label = `${fix.ticker} ${fix.fiscal_year} ${fix.fiscal_period}`;
    const { data: rows } = await db
      .from("company_financials")
      .select("id, data")
      .eq("ticker", fix.ticker)
      .eq("fiscal_year", fix.fiscal_year)
      .eq("fiscal_period", fix.fiscal_period)
      .eq("statement_type", "income_statement");

    for (const r of rows ?? []) {
      const data = (r.data ?? {}) as Record<string, unknown>;
      console.log(`restate ${label}  eps ${data.eps} -> ${fix.eps}`);
      console.log(`         ${fix.note}`);
      if (!APPLY) continue;
      const { error } = await db
        .from("company_financials")
        .update({ data: { ...data, eps: fix.eps }, validation_flags: ["hand_read", "split_restated"] })
        .eq("id", r.id);
      if (error) console.log(`         ERROR: ${error.message}`);
    }
  }

  for (const q of QUARANTINE) {
    const label = `${q.ticker} ${q.fiscal_year} ${q.fiscal_period}`;
    const { data: rows } = await db
      .from("company_financials")
      .select("id")
      .eq("ticker", q.ticker)
      .eq("fiscal_year", q.fiscal_year)
      .eq("fiscal_period", q.fiscal_period)
      .eq("statement_type", "income_statement")
      .eq("review_status", "published");

    for (const r of rows ?? []) {
      console.log(`quarant ${label}`);
      console.log(`         ${q.note}`);
      if (!APPLY) continue;
      const { error } = await db
        .from("company_financials")
        .update({ review_status: "needs_review", validation_flags: ["contradicted_by_filing"] })
        .eq("id", r.id);
      if (error) console.log(`         ERROR: ${error.message}`);
    }
  }

  if (APPLY) {
    const { refreshRatios } = await import("@/lib/engine/ratios");
    console.log("\nrecomputing ratios:");
    for (const t of ["GWLC", "THCCL", "POWER", "FECTC", "DCL", "DNCC", "SMCPL"]) {
      const r = await refreshRatios(db, t);
      console.log(`  ${t}: ${r.available}/${r.computed} ratios`);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
