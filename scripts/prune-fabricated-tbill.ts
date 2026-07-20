// Removes TBILL rows that predate the earliest SBP policy step we actually know.
//
// buildMacroAssetRows used to span the T-bill series across the union of every
// fetched asset date. Gold and USD/PKR reach back to 2007, so tbillYieldOn()
// carried the earliest known step (7.0%, effective 2021-01-01) backwards for
// roughly fourteen years and wrote a flat policy path that never happened.
// Those rows are indistinguishable from real observations once stored, and any
// model trained on them would learn a fictional rate regime.
//
// buildMacroAssetRows now clamps to the first known step, so no new rows like
// this are written. This clears the ones already persisted.
//
//   npx tsx scripts/prune-fabricated-tbill.ts           # report only
//   npx tsx scripts/prune-fabricated-tbill.ts --write   # delete them

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });

/** First date TBILL_YIELD_STEPS actually describes. Anything earlier is invented. */
const FIRST_KNOWN_STEP = "2021-01-01";

async function main() {
  const write = process.argv.includes("--write");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase
    .from("macro_asset_history")
    .select("asof_date, close_native")
    .eq("asset", "TBILL")
    .lt("asof_date", FIRST_KNOWN_STEP)
    .order("asof_date", { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) {
    console.log(`No TBILL rows before ${FIRST_KNOWN_STEP}. Nothing to prune.`);
    return;
  }

  const values = [...new Set(rows.map((r) => Number(r.close_native)))];
  console.log(`Found ${rows.length} TBILL row(s) before ${FIRST_KNOWN_STEP}.`);
  console.log(`  range   : ${rows[0].asof_date} -> ${rows[rows.length - 1].asof_date}`);
  console.log(`  value(s): ${values.join(", ")}%  (a flat carried-back rate, not observed policy)`);

  if (!write) {
    console.log("\nReport only. Re-run with --write to delete these rows.");
    return;
  }

  const { error: delError } = await supabase
    .from("macro_asset_history")
    .delete()
    .eq("asset", "TBILL")
    .lt("asof_date", FIRST_KNOWN_STEP);
  if (delError) throw delError;
  console.log(`\nDeleted ${rows.length} fabricated TBILL row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
