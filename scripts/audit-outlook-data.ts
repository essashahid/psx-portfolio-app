// Phase 1 data audit for the PSX Market Outlook.
//
// Reports exactly what historical data exists (range, granularity, gaps,
// quality), what is missing, and how often each candidate outcome actually
// occurred in the index history — including the honest independent-sample count
// per horizon, which is what decides whether a horizon is worth modelling.
//
// Produces no forecasts. It exists to answer whether forecasting is supportable
// before any model is built.
//
//   npx tsx scripts/audit-outlook-data.ts            # print report
//   npx tsx scripts/audit-outlook-data.ts --write    # also write data/outlook-data-audit.json

import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildOutlookCoverage } from "@/lib/engine/outlook/coverage";

config({ path: resolve(process.cwd(), ".env.local") });

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");
const signedPct = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "n/a");

async function main() {
  const write = process.argv.includes("--write");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const report = await buildOutlookCoverage(supabase);

  console.log("=".repeat(78));
  console.log("PSX MARKET OUTLOOK — PHASE 1 DATA AUDIT");
  console.log(`Generated ${report.generatedAt}`);
  console.log("=".repeat(78));

  console.log("\n--- SERIES COVERAGE ---\n");
  console.log(
    `${"SERIES".padEnd(34)} ${"GRAIN".padEnd(8)} ${"ROWS".padStart(6)} ${"RANGE".padEnd(25)} ${"YEARS".padStart(6)} ${"AGE".padStart(5)} ${"QUALITY".padEnd(8)} TRAINABLE`
  );
  for (const s of report.series) {
    const range = s.firstDate ? `${s.firstDate} -> ${s.lastDate}` : "none";
    console.log(
      `${s.label.slice(0, 33).padEnd(34)} ${s.granularity.padEnd(8)} ${String(s.rows).padStart(6)} ${range.padEnd(25)} ${s.years.toFixed(2).padStart(6)} ${String(s.ageDays ?? "-").padStart(4)}d ${s.quality.padEnd(8)} ${s.modelReady ? "yes" : "no"}`
    );
  }

  const stale = report.series.filter((s) => s.quality === "stale");
  if (stale.length) {
    console.log("\n  ! STALE SERIES (these go quiet without complaining):");
    for (const s of stale) console.log(`    - ${s.label}: last value ${s.lastDate}, ${s.ageDays} days old. ${s.note}`);
  }

  if (report.bindingConstraint) {
    console.log(
      `\n  Binding constraint on any training window: ${report.bindingConstraint.series} — ${report.bindingConstraint.years.toFixed(2)}y from ${report.bindingConstraint.firstDate}.`
    );
  }

  if (report.index) {
    console.log("\n--- INDEX CONTINUITY ---\n");
    console.log(`  ${report.index.ticker}: ${report.index.points} sessions, ${report.index.firstDate} -> ${report.index.lastDate} (${report.index.years.toFixed(2)}y)`);
    console.log(`  Missing weekdays in total: ${report.index.gaps.totalMissingWeekdays} (holidays + closures). Longest run: ${report.index.gaps.longestGapWeekdays} weekdays.`);
    if (report.index.gaps.gaps.length) {
      console.log("  Longest gaps:");
      for (const g of report.index.gaps.gaps.slice(0, 5)) {
        console.log(`    ${g.from} -> ${g.to}  (${g.missingWeekdays} weekdays)`);
      }
    }
  }

  console.log("\n--- HORIZON EVIDENCE (backward-looking base rates, full sample) ---\n");
  console.log(
    `${"HORIZON".padEnd(24)} ${"OVERLAP".padStart(8)} ${"INDEP".padStart(6)} ${"UP RATE".padStart(8)} ${"RET p10".padStart(9)} ${"MEDIAN".padStart(8)} ${"RET p90".padStart(9)} ${"WORST DD".padStart(9)}`
  );
  for (const h of report.horizons) {
    console.log(
      `${h.label.padEnd(24)} ${String(h.overlappingWindows).padStart(8)} ${String(h.independentWindows).padStart(6)} ${pct(h.positiveRate).padStart(8)} ${signedPct(h.returnPercentiles.p10).padStart(9)} ${signedPct(h.returnPercentiles.median).padStart(8)} ${signedPct(h.returnPercentiles.p90).padStart(9)} ${signedPct(h.drawdownPercentiles.worst).padStart(9)}`
    );
  }

  console.log("\n--- DRAWDOWN FREQUENCY (share of windows reaching each decline) ---\n");
  const thresholds = report.horizons[0]?.thresholds.map((t) => t.threshold) ?? [];
  console.log(`${"HORIZON".padEnd(24)} ${thresholds.map((t) => `${(t * 100).toFixed(0)}%`.padStart(9)).join(" ")}   INDEP SAMPLE`);
  for (const h of report.horizons) {
    const cells = h.thresholds.map((t) => `${pct(t.frequency)} `.padStart(9)).join(" ");
    console.log(`${h.label.padEnd(24)} ${cells}   ${h.independentWindows}`);
  }
  console.log(
    "\n  Read the independent-sample column, not the percentages alone. Overlapping\n  windows reuse the same market episodes, so a 3-month rate computed from ~1,175\n  overlapping windows really rests on far fewer distinct events."
  );

  console.log("\n--- VOLATILITY-CLUSTERING PROBE (in-sample feasibility check) ---\n");
  console.log(`${"HORIZON".padEnd(24)} ${"THRESH".padStart(7)} ${"BASE".padStart(7)} ${"LOW VOL".padStart(8)} ${"HIGH VOL".padStart(9)} ${"LIFT".padStart(6)}`);
  for (const v of report.volConditional) {
    const h = report.horizons.find((x) => x.key === v.horizonKey);
    console.log(
      `${(h?.label ?? v.horizonKey).padEnd(24)} ${`${(v.threshold * 100).toFixed(0)}%`.padStart(7)} ${pct(v.baseRate).padStart(7)} ${pct(v.lowVolRate).padStart(8)} ${pct(v.highVolRate).padStart(9)} ${(Number.isFinite(v.lift) ? v.lift.toFixed(2) : "n/a").padStart(6)}x`
    );
  }
  console.log(
    "\n  Lift above 1 means high trailing volatility preceded more drawdowns than the\n  base rate. This is in-sample and mildly optimistic (tercile cut-offs use the\n  whole sample). It indicates whether a risk model is worth building; it is not\n  itself a validated result."
  );

  console.log("\n--- KNOWN MISSING SOURCES ---\n");
  for (const m of report.missing) {
    console.log(`  [${m.obtainable}] ${m.label}`);
    console.log(`      ${m.why}`);
  }

  if (write) {
    const out = resolve(process.cwd(), "data/outlook-data-audit.json");
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${out}`);
  } else {
    console.log("\nRe-run with --write to save data/outlook-data-audit.json");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
