/**
 * Gate: is every verified entry still covering the NEWEST period we hold?
 *
 * This is the blind spot the drift gate does NOT cover, and the two fail in
 * different ways:
 *
 *   drift      the entry disagrees with the reference. Something broke.
 *   staleness  the entry still agrees with the reference and is internally
 *              consistent, but a newer filing has landed since it was
 *              checked, so the mark covers an older period than the market
 *              is trading on. NOTHING is wrong with the number; it is simply
 *              not the latest one, and the drift gate stays green throughout.
 *
 * A verification is a snapshot of one row selection at one moment, not a
 * permanent property of a company. Quarterly filings age it automatically.
 *
 * Users see this too: the ratios panel shows "verified" or "checked through
 * X, newer filing since loaded" rather than a bare verified mark.
 *
 * Exits non-zero when anything is stale so it can gate a pipeline. The same
 * check runs daily in production via /api/cron/data-health. Logic lives in
 * lib/engine/registry-health.ts.
 *
 *   npx tsx scripts/check-verified-freshness.ts
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { checkRegistryHealth } = await import("@/lib/engine/registry-health");

  const h = await checkRegistryHealth(createAdminClient());

  console.log(`verified registry: ${h.entries} entries`);
  console.log(`  covering the newest period held: ${h.current}`);
  console.log(`  STALE (newer data has landed):   ${h.stale.length}`);

  if (h.stale.length) {
    console.log(`\nSTALE — the figure is not wrong, it is just no longer the latest:`);
    for (const s of h.stale) {
      console.log(`  ${s.ticker.padEnd(8)} verified through ${s.through.padEnd(16)} but we now hold ${s.held.padEnd(9)} [${s.source}]`);
    }
    console.log(`\nRe-read the newer filing and update the entry's throughPeriod. Until then the`);
    console.log(`UI tells users the ratios reflect newer data that has not been re-checked,`);
    console.log(`rather than showing a plain verified mark over a figure checked against an`);
    console.log(`older period.`);
  }

  if (h.stale.length) process.exit(1);
  console.log(`\nall current.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
