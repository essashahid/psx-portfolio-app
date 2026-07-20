/**
 * Apply the two agent-reconciled bank corrections that independently rebuilt
 * to the Sarmaaya reference, with page citations, from
 * data/agent-reconcile-report.json.
 *
 * BAHL: the filing carries both bases; Sarmaaya quotes consolidated.
 *   FY2025 consolidated 29.19 (p177), Q1 2025 consolidated 9.65 (p58),
 *   Q1 2026 consolidated 6.54 (p58). Rebuilt TTM = 29.19 + 6.54 - 9.65 =
 *   26.08, exact to Sarmaaya's 26.08.
 * SBL: our FY2025 row was stored "unlabelled"; the filing states it
 *   unconsolidated at a different value.
 *   FY2025 unconsolidated 0.72 (p36), Q1 2025 unconsolidated 0.17 (p13),
 *   Q1 2026 unconsolidated 0.19 (p13). Rebuilt TTM = 0.72 + 0.19 - 0.17 =
 *   0.74 vs Sarmaaya 0.75 (2dp rounding).
 *
 * The other four in this batch are NOT applied:
 *   JSBL — consolidated (2.84) and unconsolidated (1.36) both read from the
 *          filing, but neither is within tolerance of the 2.1 reference.
 *          Genuinely unresolved; needs a closer read.
 *   BML  — the agent itself flagged an unexplained share-count discrepancy,
 *          and its own reconstructed EPS (8.79-8.83 either basis) is 16x
 *          off the 141.53 reference. That gap has no basis-difference
 *          explanation; the reference itself is suspect.
 *   BAFL, SNBL — verdict "we_are_right" but under-evidenced: BAFL offered
 *          no corrections to check the claim against, and SNBL's own
 *          diagnosis text implies a reconciling calculation but did not
 *          state it as a structured correction, so the rebuild had nothing
 *          to work from. A plausible claim is not the same as a checked one.
 *
 *   npx tsx scripts/apply-bank-agent-corrections.ts --dry
 *   npx tsx scripts/apply-bank-agent-corrections.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
const DRY = process.argv.includes("--dry");

const CORRECTIONS = [
  {
    ticker: "BAHL",
    basis: "consolidated" as const,
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", eps: 29.19, profit_after_tax: 32467224, reported_date: "2026-03-06" },
      { fiscal_year: 2025, fiscal_period: "Q1", eps: 9.65, profit_after_tax: 10723967, reported_date: "2026-04-29" },
      { fiscal_year: 2026, fiscal_period: "Q1", eps: 6.54, profit_after_tax: 7274739, reported_date: "2026-04-29" },
    ],
  },
  {
    ticker: "SBL",
    basis: "unconsolidated" as const,
    rows: [
      { fiscal_year: 2025, fiscal_period: "FY", eps: 0.72, revenue: 7721788, profit_after_tax: 727248, reported_date: "2026-03-05" },
      { fiscal_year: 2025, fiscal_period: "Q1", eps: 0.17, revenue: 1940223, profit_after_tax: 166849, reported_date: "2026-04-30" },
      { fiscal_year: 2026, fiscal_period: "Q1", eps: 0.19, revenue: 1643311, profit_after_tax: 193330, reported_date: "2026-04-30" },
    ],
  },
];

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  for (const c of CORRECTIONS) {
    for (const r of c.rows) {
      const periodType = r.fiscal_period === "FY" ? "annual" : "quarterly";
      console.log(`${DRY ? "[dry] " : ""}${c.ticker} ${r.fiscal_year} ${r.fiscal_period} [${c.basis}] eps=${r.eps}`);
      if (DRY) continue;
      const { error } = await db.from("company_financials").upsert(
        {
          ticker: c.ticker,
          period_type: periodType,
          fiscal_year: r.fiscal_year,
          fiscal_period: r.fiscal_period,
          statement_type: "income_statement",
          reporting_basis: c.basis,
          source_type: "psx-filing",
          reported_date: r.reported_date,
          data: { eps: r.eps, ...("revenue" in r ? { revenue: r.revenue } : {}), profit_after_tax: r.profit_after_tax },
          confidence: 0.9,
          review_status: "published",
          validation_flags: ["agent_reconciled"],
        },
        { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
      );
      if (error) console.log(`  ERROR: ${error.message}`);
    }
  }

  if (DRY) return;

  const { refreshRatios } = await import("@/lib/engine/ratios");
  for (const c of CORRECTIONS) {
    const r = await refreshRatios(db, c.ticker);
    console.log(`${c.ticker}: ${r.available}/${r.computed} ratios`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
