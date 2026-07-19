/**
 * Hand-read corrections for the Fertilizer sector.
 *
 * Every figure was read directly off the March 31, 2026 filing for each
 * company and converted to PKR thousands, the canonical unit.
 *
 * Unlike Cement, the fertilizer income statements were largely correct. The
 * gaps here are a missing balance sheet (EFERT) and a missing prior-year
 * comparative on a holding company (AHCL).
 *
 *   npx tsx scripts/fix-fertilizer-comparatives.ts          # dry run
 *   npx tsx scripts/fix-fertilizer-comparatives.ts --apply
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

type Row = {
  ticker: string;
  fiscal_year: number;
  fiscal_period: string;
  period_type: string;
  statement_type: string;
  /**
   * Required. The ratio engine's latest() sorts by reported_date before
   * fiscal_year, so a row left null sorts last and loses to an older
   * statement — which is exactly how EFERT's Q1 balance sheet was ignored.
   * Current-period rows carry the filing date we read; prior-year
   * comparatives carry the date that period was originally reported.
   */
  reported_date: string;
  data: Record<string, number>;
  note: string;
};

const UPSERTS: Row[] = [
  {
    // EFERT is Dec year-end, so the March 2026 quarter is the latest period.
    // We held income for 2026 Q1 but no balance sheet, so P/B, current ratio
    // and every leverage ratio were being computed off the Dec 2025 audited
    // sheet and labelled with the wrong period.
    ticker: "EFERT",
    fiscal_year: 2026,
    fiscal_period: "Q1",
    period_type: "quarterly",
    statement_type: "balance_sheet",
    reported_date: "2026-04-30",
    note: "2026 Q1 balance sheet was absent; ratios were falling back to 2025 FY. Balances: 42,509,710 equity + 157,049,968 liabilities = 199,559,678 total assets.",
    data: {
      total_assets: 199_559_678,
      current_assets: 88_103_556,
      cash_and_equivalents: 2_418_273,
      inventory: 24_092_570,
      receivables: 2_248_087,
      total_liabilities: 157_049_968,
      current_liabilities: 117_444_690,
      borrowings: 76_835_218,
      equity: 42_509_710,
      retained_earnings: 26_114_399,
    },
  },
  {
    // AHCL (Arif Habib Corporation) has a June year-end, so this is the 9M
    // comparative. Filed in full rupees; divided by 1,000 here.
    ticker: "AHCL",
    fiscal_year: 2025,
    fiscal_period: "9M",
    period_type: "cumulative",
    statement_type: "income_statement",
    reported_date: "2025-04-30",
    note: "9M FY2025 comparative was missing. Gross revenue 3,550,150,724 and PAT 18,251,089,594 rupees, converted to thousands.",
    data: {
      revenue: 3_550_151,
      operating_profit: 21_955_790,
      profit_before_tax: 21_946_138,
      tax: -3_695_048,
      profit_after_tax: 18_251_090,
      eps: 4.33,
    },
  },
];

/**
 * Rows contradicted by the filing. Quarantined rather than deleted so the bad
 * data stays inspectable; needs_review excludes them from the ratio engine.
 */
const QUARANTINE: { ticker: string; fiscal_year: number; fiscal_period: string; statement_type: string; note: string }[] = [
  {
    ticker: "AHCL",
    fiscal_year: 2025,
    fiscal_period: "H1",
    statement_type: "income_statement",
    note: "eps 6.05 on PAT 25,499,047 is byte-identical to the 2026 H1 row. One of the two is a copy; the FY2025 half-year cannot equal the FY2026 half-year.",
  },
];

const APPLY = process.argv.includes("--apply");

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  console.log(APPLY ? "APPLYING corrections\n" : "DRY RUN (pass --apply to write)\n");

  for (const row of UPSERTS) {
    const label = `${row.ticker} ${row.fiscal_year} ${row.fiscal_period} ${row.statement_type}`;
    const { data: existing } = await db
      .from("company_financials")
      .select("id")
      .eq("ticker", row.ticker)
      .eq("fiscal_year", row.fiscal_year)
      .eq("fiscal_period", row.fiscal_period)
      .eq("statement_type", row.statement_type)
      .eq("source_type", "psx-filing")
      .eq("reporting_basis", "unconsolidated")
      .maybeSingle();

    console.log(`${existing ? "update" : "insert"}  ${label}`);
    console.log(`         ${row.note}`);
    if (!APPLY) continue;

    const { error } = await db.from("company_financials").upsert(
      {
        ticker: row.ticker,
        period_type: row.period_type,
        fiscal_year: row.fiscal_year,
        fiscal_period: row.fiscal_period,
        statement_type: row.statement_type,
        reported_date: row.reported_date,
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

  for (const q of QUARANTINE) {
    const { data: rows } = await db
      .from("company_financials")
      .select("id")
      .eq("ticker", q.ticker)
      .eq("fiscal_year", q.fiscal_year)
      .eq("fiscal_period", q.fiscal_period)
      .eq("statement_type", q.statement_type)
      .eq("review_status", "published");

    for (const r of rows ?? []) {
      console.log(`quarant ${q.ticker} ${q.fiscal_year} ${q.fiscal_period}`);
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
    for (const t of ["EFERT", "AHCL", "FATIMA", "AGL"]) {
      const r = await refreshRatios(db, t);
      console.log(`  ${t}: ${r.available}/${r.computed} ratios`);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
