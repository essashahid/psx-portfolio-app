// Backfills the shared macro_asset_history cache used by the capital-allocation
// forecaster: Bitcoin, gold (XAU), USD/PKR and the PKR T-bill yield path. All
// sources are free and need no API key (CoinGecko, stooq). PSX equity history
// is handled separately by the eod_history cache.
//
// Dry run (fetch + report coverage, no DB write):
//   npx tsx scripts/build-macro-assets.ts
// Persist to the shared cache:
//   npx tsx scripts/build-macro-assets.ts --write

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import {
  buildMacroAssetRows,
  writeMacroAssetRows,
  assessDataQuality,
  type MacroAsset,
  type MacroAssetRow,
} from "@/lib/market-data/macro-assets";

config({ path: resolve(process.cwd(), ".env.local") });

function coverage(rows: MacroAssetRow[], asset: MacroAsset) {
  const usePkr = asset === "BTC" || asset === "GOLD";
  const points = rows
    .filter((r) => r.asset === asset)
    .map((r) => ({ date: r.asof_date, value: Number(usePkr ? r.close_pkr : r.close_native) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return assessDataQuality(points);
}

async function main() {
  const write = process.argv.includes("--write");

  console.log("Fetching BTC, gold (XAU) + USD/PKR (Twelve Data), T-bill path...");
  const { rows, fetched } = await buildMacroAssetRows();

  console.log("\n=== Coverage ===");
  for (const asset of ["BTC", "GOLD", "USDPKR", "TBILL"] as MacroAsset[]) {
    const q = coverage(rows, asset);
    const span = q.firstDate ? `${q.firstDate} -> ${q.lastDate} (${q.years.toFixed(1)}y)` : "none";
    console.log(`  ${asset.padEnd(7)} fetched ${String(fetched[asset]).padStart(6)}  ${q.quality.padEnd(8)} ${span}`);
  }

  const missing = (["BTC", "GOLD", "USDPKR"] as MacroAsset[]).filter((a) => fetched[a] === 0);
  if (missing.length) console.warn(`\n! No data fetched for: ${missing.join(", ")} (source may be rate-limited; retry later).`);

  if (!write) {
    console.log("\nDry run only. Re-run with --write to persist to macro_asset_history.");
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const written = await writeMacroAssetRows(supabase, rows);
  console.log(`\nWrote ${written} macro_asset_history rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
