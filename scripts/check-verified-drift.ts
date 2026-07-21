/**
 * Gate: does every entry in the verified registry STILL agree with its
 * independent reference?
 *
 * This exists because of a blind spot that let seven entries go stale
 * unnoticed. The regression run after each change compared the registry
 * before and after THAT change ("did I break anything?"). It never asked the
 * different question "does the registry still agree with the reference?" — so
 * when a later extraction rewrote a company's financials, the entry kept
 * asserting a verification that had quietly stopped holding.
 *
 * HBL is the clean proof. Verified 7 July against a reference of 45.16. The
 * reference never moved, confirmed from git history. It later served 42.81,
 * because a 16 July extraction added rows that changed which ones the
 * trailing chain selects.
 *
 * Run after ANY extraction or backfill, not just after manual edits. Exits
 * non-zero on drift so it can gate a pipeline. The same check runs daily in
 * production via /api/cron/data-health.
 *
 * Logic lives in lib/engine/registry-health.ts so this script, its freshness
 * sibling and the cron cannot disagree about what counts as drift.
 *
 *   npx tsx scripts/check-verified-drift.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { checkRegistryHealth } = await import("@/lib/engine/registry-health");

  const h = await checkRegistryHealth(createAdminClient());

  console.log(`verified registry: ${h.entries} entries`);
  console.log(`  agree with reference: ${h.agreeing}`);
  console.log(`  no reference to check: ${h.noReference}`);
  console.log(`  expected divergence:  ${h.expectedDivergence.length}${h.expectedDivergence.length ? ` (${h.expectedDivergence.join(", ")})` : ""}`);
  console.log(`  DRIFTED:              ${h.drifted.length}`);

  if (h.missingData.length) {
    console.log(`\nMISSING DATA — registry says verified but we serve no EPS:\n  ${h.missingData.join(", ")}`);
  }
  if (h.drifted.length) {
    console.log(`\nDRIFTED — these claim a verification that no longer holds:`);
    for (const d of h.drifted) {
      console.log(`  ${d.ticker.padEnd(8)} served ${d.served.toFixed(2).padStart(9)} vs ref ${String(d.reference).padStart(9)}  (${d.gapPct.toFixed(1)}%)  [${d.source}]`);
    }
    console.log(`\nEach needs one of: re-verification against the filing, a basis correction, an`);
    console.log(`EXPECTED_DIVERGENCE entry in lib/engine/registry-health.ts explaining why the`);
    console.log(`reference is the wrong yardstick, or removal from the registry. Leaving it is`);
    console.log(`the one option that is not acceptable, because the registry is what tells users`);
    console.log(`a figure was independently checked.`);
  }

  if (h.drifted.length || h.missingData.length) process.exit(1);
  console.log(`\nall good.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
