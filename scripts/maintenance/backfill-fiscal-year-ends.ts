import { loadEnvLocal } from "../lib/load-env";
import { readFileSync } from "node:fs";

/**
 * Fill company_metadata.fiscal_year_end_month from the Phase 0 filing inventory.
 *
 * The year end is only recorded today when the PDF extractor happened to read
 * it off a balance sheet heading, so most companies have none — 37 of 114
 * holdings, including PPL, PSO, SEARL and KAPCO. Anything needing a fiscal
 * calendar then refuses: the ratio history cannot date or price a period
 * without one, so those companies produced nothing at all.
 *
 * The inventory already inferred it for the whole universe from the period
 * ends companies state in their own annual filing titles, at no cost. This
 * copies that across. Never overwrites a value already recorded from a filing,
 * which is the stronger source.
 *
 *   npx tsx scripts/maintenance/backfill-fiscal-year-ends.ts [--dry]
 */
const MANIFEST = "data/reference/filing-archive-inventory.json";

async function main() {
  loadEnvLocal();
  const dry = process.argv.includes("--dry");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const entries = JSON.parse(readFileSync(MANIFEST, "utf8")).entries as Record<
    string,
    { fiscalYearEndMonth: number | null; fiscalYearEndSource: string }
  >;

  const { data: existing } = await db.from("company_metadata").select("ticker, fiscal_year_end_month");
  const have = new Map((existing ?? []).map((r) => [String(r.ticker).toUpperCase(), r.fiscal_year_end_month as number | null]));

  const todo: { ticker: string; month: number }[] = [];
  for (const [ticker, e] of Object.entries(entries)) {
    if (!e.fiscalYearEndMonth) continue;
    if (have.get(ticker)) continue; // a filing-read value wins
    todo.push({ ticker, month: e.fiscalYearEndMonth });
  }

  console.log(`${Object.keys(entries).length} companies in the inventory, ${todo.length} missing a year end that it can supply`);
  if (dry) {
    console.log(todo.map((t) => `${t.ticker}:${t.month}`).join(" "));
    return;
  }

  const now = new Date().toISOString();
  let saved = 0;
  for (let i = 0; i < todo.length; i += 200) {
    const chunk = todo.slice(i, i + 200).map((t) => ({
      ticker: t.ticker,
      fiscal_year_end_month: t.month,
      last_updated: now,
    }));
    const { error } = await db.from("company_metadata").upsert(chunk, { onConflict: "ticker" });
    if (error) { console.error(`  upsert: ${error.message}`); continue; }
    saved += chunk.length;
  }
  console.log(`recorded ${saved} fiscal year ends`);
}

main().catch((e) => { console.error(e); process.exit(1); });
