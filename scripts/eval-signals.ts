// Phase 2 signal evaluation for the PSX Market Outlook.
//
// Runs every signal in lib/engine/outlook/signals.ts through the point-in-time
// evaluation harness and prints the evidence: lift on distinct episodes, value
// beyond volatility, stability across sample halves, and the resulting
// classification. No model is fitted and nothing here forecasts.
//
//   npx tsx scripts/eval-signals.ts            # print report
//   npx tsx scripts/eval-signals.ts --write    # also write data/outlook-signal-evidence.json

import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadAlignedInputs } from "@/lib/engine/outlook/inputs";
import { buildSignalEvidence, type CellEvidence } from "@/lib/engine/outlook/evaluate";

config({ path: resolve(process.cwd(), ".env.local") });

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");
const x = (v: number | null) => (v !== null && Number.isFinite(v) ? `${v.toFixed(2)}x` : "n/a");

function cellLine(c: CellEvidence): string {
  const beyond = c.beyondVol ? ` beyond-vol ${x(c.beyondVol.lift)} (${c.beyondVol.hitEpisodes}ep)` : "";
  const halves = ` halves ${x(c.firstHalfLift)}/${x(c.secondHalfLift)}`;
  return `    ${c.horizonKey.padEnd(4)} ${(Math.abs(c.threshold * 100).toFixed(0) + "%").padStart(3)}  base ${pct(c.baseRate).padStart(6)}  risky ${pct(c.riskyRate).padStart(6)}  lift ${x(c.lift).padStart(6)}  ep ${String(c.hitEpisodes).padStart(2)}${halves}${beyond}  -> ${c.classification.toUpperCase()}${c.secondary ? " (secondary)" : ""}`;
}

async function main() {
  const write = process.argv.includes("--write");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  console.log("Loading aligned inputs...");
  const inputs = await loadAlignedInputs(supabase);
  console.log(`Master calendar: ${inputs.dates.length} sessions, ${inputs.dates[0]} -> ${inputs.dates[inputs.dates.length - 1]}`);

  const report = buildSignalEvidence(inputs);

  console.log("\n" + "=".repeat(100));
  console.log("PHASE 2 SIGNAL EVIDENCE (descriptive, in-sample, point-in-time states)");
  console.log("=".repeat(100));

  for (const s of report.signals) {
    console.log(`\n${s.label}  [${s.key}, ${s.family}, risky=${s.riskyDirection}]`);
    console.log(`  coverage ${s.coverage.firstDate} -> ${s.coverage.lastDate} (${s.coverage.observations} obs)  VERDICT: ${s.verdict.toUpperCase()}`);
    console.log(`  ${s.verdictReason}`);
    for (const c of s.cells) console.log(cellLine(c));
  }

  console.log("\n" + "-".repeat(100));
  console.log("SIGNAL PAIRS (lift of the second signal's risky state inside the anchor's safe third)");
  for (const p of report.pairs) {
    console.log(`\n${p.anchor} x ${p.other} — ${p.why}`);
    for (const c of p.cells) {
      console.log(
        `    ${c.horizonKey.padEnd(4)} ${(Math.abs(c.threshold * 100).toFixed(0) + "%").padStart(3)}  safe+safe ${pct(c.anchorSafeOtherSafe.rate).padStart(6)}  safe+risky ${pct(c.anchorSafeOtherRisky.rate).padStart(6)}  lift ${x(c.liftWithinAnchorSafe).padStart(6)}  ep ${c.hitEpisodes}${c.quotable ? "" : "  (too thin)"}`
      );
    }
  }

  console.log("\n" + "-".repeat(100));
  console.log("REGIMES (trend x volatility, descriptive occupancy and drawdown rates)");
  for (const r of report.regimes) {
    const cells = r.cells.map((c) => `${c.horizonKey}@${Math.abs(c.threshold * 100).toFixed(0)}%: ${pct(c.rate)} (${c.hitEpisodes}ep)`).join("  ");
    console.log(`  ${r.label.padEnd(26)} occupancy ${pct(r.occupancyShare).padStart(6)}  ${cells}`);
  }

  const verdictCounts = report.signals.reduce<Record<string, number>>((acc, s) => {
    acc[s.verdict] = (acc[s.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nVerdicts: ${JSON.stringify(verdictCounts)}`);

  if (write) {
    const out = resolve(process.cwd(), "data/outlook-signal-evidence.json");
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${out}`);
  } else {
    console.log("\nRe-run with --write to save data/outlook-signal-evidence.json");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
