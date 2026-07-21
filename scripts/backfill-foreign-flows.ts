// Backfills historical daily FIPI/LIPI flows from SCSTrade's public tables.
//
// The daily cron only ever captures the current session, so flow history began
// when the cron did. SCSTrade's endpoints do accept an arbitrary date, though,
// which means the archive is reachable one session at a time. Its chart
// endpoint ignores its own date parameters and always returns the last thirty
// sessions, so there is no bulk range to page through; this walks day by day.
//
// Trading days are taken from the KSE-100 close history rather than guessed
// from the calendar, so the walk skips weekends and PSX holidays for free.
//
//   npx tsx scripts/backfill-foreign-flows.ts --from 2021-07-23        # dry run
//   npx tsx scripts/backfill-foreign-flows.ts --from 2021-07-23 --write
//   npx tsx scripts/backfill-foreign-flows.ts --from 2025-01-01 --write --limit 50

import { config } from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchScsTradeFlows, ingestForeignFlows } from "@/lib/market/foreign-flows-ingest";

config({ path: resolve(process.cwd(), ".env.local") });

/** Politeness gap between requests. SCSTrade is a courtesy source, not an API. */
const REQUEST_SPACING_MS = 900;
/** Consecutive empty responses before concluding the archive has run out. */
const EMPTY_RUN_LIMIT = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

/** PSX trading days, taken from the index close history we already hold. */
async function tradingDays(supabase: SupabaseClient, from: string, to: string): Promise<string[]> {
  const PAGE = 1000;
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("price_date")
      .eq("ticker", "KSE100")
      .gte("price_date", from)
      .lte("price_date", to)
      .order("price_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows.map((r) => r.price_date as string));
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Sessions already stored, so a re-run resumes instead of refetching. */
async function existingDates(supabase: SupabaseClient): Promise<Set<string>> {
  const PAGE = 1000;
  const out = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("foreign_flow_days")
      .select("flow_date")
      .order("flow_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) out.add(r.flow_date as string);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function main() {
  const write = process.argv.includes("--write");
  const from = arg("from") ?? "2021-07-23";
  const to = arg("to") ?? new Date().toISOString().slice(0, 10);
  const limit = Number(arg("limit") ?? "0") || Infinity;
  const force = process.argv.includes("--force");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const days = await tradingDays(supabase, from, to);
  const have = force ? new Set<string>() : await existingDates(supabase);
  // Newest first: the recent archive is the most reliable and the most useful,
  // so a run that is cut short still leaves the freshest history in place.
  const todo = days.filter((d) => !have.has(d)).reverse().slice(0, limit);

  console.log(`Trading days ${from} to ${to}: ${days.length}`);
  console.log(`Already stored: ${have.size}. To fetch: ${todo.length}${limit !== Infinity ? ` (limited)` : ""}`);
  if (!write) {
    console.log("\nDry run. Re-run with --write to fetch and persist.");
    console.log(`Estimated wall time if written: ~${Math.round((todo.length * REQUEST_SPACING_MS) / 60000)} min`);
    return;
  }

  let saved = 0;
  let empty = 0;
  let emptyRun = 0;
  for (const [i, date] of todo.entries()) {
    const payload = await fetchScsTradeFlows(date);
    if (!payload) {
      empty++;
      emptyRun++;
      if (emptyRun >= EMPTY_RUN_LIMIT) {
        console.log(`\nStopping: ${EMPTY_RUN_LIMIT} consecutive sessions returned nothing, so the archive likely ends here.`);
        break;
      }
    } else {
      emptyRun = 0;
      // The payload carries the date we asked for, so a session the source
      // silently reports under a different date cannot overwrite another day.
      await ingestForeignFlows(supabase, { ...payload, date }, { ingestedBy: "auto" });
      saved++;
    }
    if ((i + 1) % 25 === 0 || i === todo.length - 1) {
      console.log(`  ${i + 1}/${todo.length}  saved ${saved}  empty ${empty}  (at ${date})`);
    }
    await sleep(REQUEST_SPACING_MS);
  }

  console.log(`\nDone. Saved ${saved} session(s), ${empty} returned no data.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
