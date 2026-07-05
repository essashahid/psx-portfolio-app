import { loadEnvLocal } from "./load-env";

/**
 * One-shot coverage kickstart (safe to re-run):
 *
 *  1. Sync the PSX directory (instrument types + delist absentees) and
 *     reconcile listing status (suspend dead counters, promote traded ones).
 *  2. Run cheap fundamentals (PSX company page + payout history + ratios,
 *     no LLM) for every live company that is missing income statements or
 *     payout history.
 *
 * The nightly crons keep everything fresh afterwards; this just collapses the
 * weeks the rotations would need to converge into one run.
 *
 *   npx tsx scripts/backfill-universe-fundamentals.ts [--limit N] [--all]
 */

async function main() {
  loadEnvLocal();
  // Imports that construct clients must come after env is loaded.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { syncUniverseDirectory, reconcileListingStatus, activeUniverseTickers } = await import("@/lib/engine/universe");
  const { populateCheapFundamentals } = await import("@/lib/engine/fundamentals");

  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
  const refreshAll = args.includes("--all");

  const db = createAdminClient();

  console.log("1/3 Syncing PSX directory…");
  const sync = await syncUniverseDirectory(db);
  if ("error" in sync) throw new Error(sync.error);
  console.log(`    ${sync.listings} listings, ${sync.delisted} delisted, ${sync.revived} revived`);

  console.log("2/3 Reconciling listing status…");
  const status = await reconcileListingStatus(db);
  console.log(`    ${status.suspended} suspended, ${status.promoted} promoted`);

  console.log("3/3 Cheap fundamentals (company page + payouts + ratios)…");
  const companies = await activeUniverseTickers(db, "companies");
  const [{ data: income }, { data: payouts }] = await Promise.all([
    db
      .from("company_financials")
      .select("ticker")
      .eq("statement_type", "income_statement")
      .eq("review_status", "published")
      .limit(10000),
    db.from("company_payouts").select("ticker").limit(20000),
  ]);
  const hasIncome = new Set((income ?? []).map((r) => (r.ticker as string).toUpperCase()));
  const hasPayouts = new Set((payouts ?? []).map((r) => (r.ticker as string).toUpperCase()));
  const queue = companies
    .filter((t) => refreshAll || !hasIncome.has(t) || !hasPayouts.has(t))
    .slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(`    ${companies.length} live companies, ${queue.length} in queue`);

  let done = 0;
  let pageOk = 0;
  let payoutOk = 0;
  const failures: string[] = [];
  const CONCURRENCY = 5;
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < queue.length) {
        const t = queue[i++];
        try {
          const r = await populateCheapFundamentals(t, db);
          if (r.pagePeriods > 0) pageOk++;
          if (r.payouts > 0) payoutOk++;
          if (r.pagePeriods === 0 && r.payouts === 0) failures.push(t);
        } catch {
          failures.push(t);
        }
        done++;
        if (done % 25 === 0) console.log(`    ${done}/${queue.length} (page ${pageOk}, payouts ${payoutOk})`);
      }
    })
  );

  console.log(`Done: ${done} processed, ${pageOk} with financial pages, ${payoutOk} with payouts.`);
  if (failures.length) console.log(`No data from either source (${failures.length}): ${failures.slice(0, 40).join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
