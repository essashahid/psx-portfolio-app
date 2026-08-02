import { loadEnvLocal } from "../lib/load-env";

/**
 * Compute dated ratios for every fiscal period a company has filed.
 *
 * The five-year backfill bought depth that the snapshot ratio engine does not
 * read: holdings hold 1,772 balance sheets and 1,702 cash flows, and
 * company_ratios still emits one row per ratio for the latest period only.
 * This turns that depth into a series. No AI and no PDFs, so it is free to
 * re-run whenever the underlying figures change.
 *
 *   npx tsx scripts/backfills/build-ratio-history.ts --holdings
 *   npx tsx scripts/backfills/build-ratio-history.ts --tickers OGDC,LUCK --years 5
 *   npx tsx scripts/backfills/build-ratio-history.ts --universe --annual-only
 */

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0) return process.argv[i + 1] ?? null;
  const inline = process.argv.find((a) => a.startsWith(`--${n}=`));
  return inline ? inline.split("=").slice(1).join("=") : null;
};
const KNOWN = new Set(["holdings", "universe", "tickers", "years", "annual-only", "limit"]);
for (const a of process.argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const n = a.slice(2).split("=")[0];
  if (!KNOWN.has(n)) { console.error(`unknown flag --${n}`); process.exit(1); }
}

async function main() {
  loadEnvLocal();
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { computeRatioHistory } = await import("@/lib/engine/ratio-history");
  const db = createAdminClient();

  const only = new Set((arg("tickers") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  let tickers: string[];
  if (only.size) tickers = [...only].sort();
  else if (process.argv.includes("--holdings")) {
    const { data } = await db.from("holdings").select("ticker").gt("quantity", 0);
    tickers = [...new Set((data ?? []).map((r) => String(r.ticker).toUpperCase()))].sort();
  } else if (process.argv.includes("--universe")) {
    tickers = [...new Set(await activeUniverseTickers(db, "companies"))].sort();
  } else { console.error("choose --holdings, --universe or --tickers"); process.exit(1); }
  if (arg("limit")) tickers = tickers.slice(0, Number(arg("limit")));

  const years = Number(arg("years")) || 5;
  const includeInterim = !process.argv.includes("--annual-only");
  console.log(`${tickers.length} companies, ${years}-year window, ${includeInterim ? "annual + interim" : "annual only"}\n`);

  let periods = 0, rows = 0, computed = 0, done = 0;
  const skipped: string[] = [];
  for (const t of tickers) {
    const r = await computeRatioHistory(db, t, { years, includeInterim }).catch((e) => {
      skipped.push(`${t}: ${e instanceof Error ? e.message : e}`); return null;
    });
    done++;
    if (!r) continue;
    periods += r.periods; rows += r.rows; computed += r.computed;
    if (r.skipped.length) skipped.push(`${t}: ${r.skipped.join("; ")}`);
    if (done % 20 === 0 || done === tickers.length) console.log(`  ${done}/${tickers.length}  periods=${periods} rows=${rows} computed=${computed}`);
  }

  console.log(`\n${"=".repeat(56)}\nRATIO HISTORY BUILT\n${"=".repeat(56)}`);
  console.log(`companies            ${tickers.length}`);
  console.log(`fiscal periods       ${periods}`);
  console.log(`ratio rows written   ${rows}`);
  console.log(`  with a value       ${computed} (${rows ? (computed / rows * 100).toFixed(1) : 0}%)`);
  if (skipped.length) {
    console.log(`\nskipped (${skipped.length}):`);
    for (const s of skipped.slice(0, 25)) console.log(`  ${s}`);
    if (skipped.length > 25) console.log(`  ... and ${skipped.length - 25} more`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
