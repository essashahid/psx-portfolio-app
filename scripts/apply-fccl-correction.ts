/**
 * Apply the FCCL Q1/Q2 FY2025 correction found by the reconciliation agent.
 *
 * The annual report's quarterly-breakdown table (page 210) gives FY2025:
 * Q1 1.32, Q2 1.64, Q3 0.87 (already matches what we store), Q4 1.59 —
 * summing to 5.42, consistent with the stored FY2025 annual EPS of 5.43.
 *
 * What we had stored was swapped: "2025 Q2" held 2.96 (which is actually
 * Q1+Q2 = 1.32+1.64) and "2025 H1" held 1.64 (which is actually Q2 alone).
 * Q1 2025 was missing entirely.
 *
 * With the quarters corrected, 9M FY2025 = 1.32+1.64+0.87 = 3.83 (via the
 * engine's quarter-sum fallback — no direct 9M row existed or is needed).
 * Rebuilt TTM = FY2025 5.43 + 9M 2026 4.39 - 9M 2025 3.83 = 5.99, exact to
 * Sarmaaya's reference.
 *
 *   npx tsx scripts/apply-fccl-correction.ts --dry
 *   npx tsx scripts/apply-fccl-correction.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
const DRY = process.argv.includes("--dry");
const REPORTED_DATE = "2025-09-09"; // annual report filing date; source of the page-210 table

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  // 1. Quarantine the two rows page 210 contradicts.
  const wrong = [
    { fiscal_period: "Q2", why: "stored 2.96, filing page 210 shows Q2 alone is 1.64 (2.96 is actually Q1+Q2)" },
    { fiscal_period: "H1", why: "stored 1.64, filing page 210 implies H1 = Q1+Q2 = 1.32+1.64 = 2.96" },
  ];
  for (const w of wrong) {
    const { data: rows } = await db
      .from("company_financials")
      .select("id,data")
      .eq("ticker", "FCCL")
      .eq("statement_type", "income_statement")
      .eq("fiscal_year", 2025)
      .eq("fiscal_period", w.fiscal_period)
      .eq("review_status", "published");
    for (const r of rows ?? []) {
      console.log(`${DRY ? "[dry] " : ""}quarantine FCCL 2025 ${w.fiscal_period} (eps ${(r.data as { eps?: number })?.eps}) — ${w.why}`);
      if (DRY) continue;
      const { error } = await db
        .from("company_financials")
        .update({ review_status: "needs_review", validation_flags: ["contradicted_by_annual_breakdown"] })
        .eq("id", r.id);
      if (error) console.log(`  ERROR: ${error.message}`);
    }
  }

  // 2. Insert the corrected quarters, unconsolidated, page-210-cited.
  const rows = [
    { fiscal_period: "Q1", eps: 1.32 },
    { fiscal_period: "Q2", eps: 1.64 },
    { fiscal_period: "H1", eps: 2.96 },
  ];
  for (const r of rows) {
    console.log(`${DRY ? "[dry] " : ""}insert FCCL 2025 ${r.fiscal_period} [unconsolidated] eps=${r.eps}`);
    if (DRY) continue;
    const { error } = await db.from("company_financials").upsert(
      {
        ticker: "FCCL",
        period_type: r.fiscal_period === "H1" ? "cumulative" : "quarterly",
        fiscal_year: 2025,
        fiscal_period: r.fiscal_period,
        statement_type: "income_statement",
        reporting_basis: "unconsolidated",
        source_type: "psx-filing",
        reported_date: REPORTED_DATE,
        data: { eps: r.eps },
        confidence: 0.9,
        review_status: "published",
        validation_flags: ["agent_reconciled"],
      },
      { onConflict: "ticker,period_type,fiscal_year,fiscal_period,statement_type,reporting_basis,source_type" }
    );
    if (error) console.log(`  ERROR: ${error.message}`);
  }

  if (DRY) return;

  const { refreshRatios } = await import("@/lib/engine/ratios");
  const res = await refreshRatios(db, "FCCL");
  console.log(`\nFCCL: ${res.available}/${res.computed} ratios`);

  const { data: pe } = await db.from("company_ratios").select("inputs,source_period").eq("ticker", "FCCL").eq("ratio_name", "P/E").maybeSingle();
  console.log(`P/E now: eps=${(pe?.inputs as { eps?: number })?.eps} basis="${pe?.source_period}"`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
