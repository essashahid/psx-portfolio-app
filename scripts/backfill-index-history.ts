// Deep-backfills PSX index history into the shared company_price_history cache.
//
// Why this exists separately from lib/market-data/eod-cache.ts: ensureEodCached
// only writes dates NEWER than what is already cached, because its job is a
// cheap daily top-up. That makes it structurally unable to deepen history. This
// script upserts every date the portal returns, so a cache that started shallow
// gets filled back to the portal's full depth.
//
// Note the portal serves a rolling window (~5 years) rather than the full index
// history, so the depth this can reach is bounded by the source, not by us.
// Whatever older rows are already cached are preserved: we only ever upsert.
//
// Dry run (fetch + report coverage vs what is cached, no DB write):
//   npx tsx scripts/backfill-index-history.ts
// Persist:
//   npx tsx scripts/backfill-index-history.ts --write
// Extra symbols:
//   npx tsx scripts/backfill-index-history.ts --symbols KSE100,KMI30 --write

import { config } from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchPsxEod, PSX_PRICE_SOURCE, type EodCandle } from "@/lib/market-data/psx-dps";

config({ path: resolve(process.cwd(), ".env.local") });

/**
 * PSX headline indices worth caching. KSE100 is the benchmark the outlook work
 * is built on; the others are fetched opportunistically and skipped without
 * complaint when the portal has no series for them.
 */
const DEFAULT_SYMBOLS = ["KSE100", "KSE30", "KMI30", "ALLSHR"];

interface Coverage {
  rows: number;
  firstDate: string | null;
  lastDate: string | null;
  years: number;
}

function coverageOf(dates: string[]): Coverage {
  if (dates.length === 0) return { rows: 0, firstDate: null, lastDate: null, years: 0 };
  const sorted = [...dates].sort();
  const firstDate = sorted[0];
  const lastDate = sorted[sorted.length - 1];
  return {
    rows: sorted.length,
    firstDate,
    lastDate,
    years: (Date.parse(lastDate) - Date.parse(firstDate)) / (365.25 * 86_400_000),
  };
}

function fmtCoverage(c: Coverage): string {
  if (!c.firstDate) return "none";
  return `${c.firstDate} -> ${c.lastDate} (${c.rows} rows, ${c.years.toFixed(2)}y)`;
}

/** Every cached date for a symbol, paging past the PostgREST row cap. */
async function cachedDates(supabase: SupabaseClient, ticker: string): Promise<string[]> {
  const PAGE = 1000;
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("price_date")
      .eq("ticker", ticker)
      .order("price_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows.map((r) => r.price_date as string));
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Collapse candles to one per trade date. The portal occasionally returns more
 * than one timestamp that falls on the same Pakistan-time date; upserting both
 * makes Postgres reject the whole batch ("cannot affect row a second time").
 * Last write wins, matching uniqueByDate() in lib/market-data/eod-cache.ts.
 */
function dedupeByDate(candles: EodCandle[]): EodCandle[] {
  const byDate = new Map<string, EodCandle>();
  for (const c of candles) byDate.set(c.date, c);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Upsert the full candle set. Chunked to stay under request-size limits. */
async function writeCandles(
  supabase: SupabaseClient,
  ticker: string,
  input: EodCandle[]
): Promise<number> {
  const candles = dedupeByDate(input);
  const CHUNK = 1000;
  const now = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < candles.length; i += CHUNK) {
    const chunk = candles.slice(i, i + CHUNK).map((c) => ({
      ticker,
      price_date: c.date,
      close: c.close,
      volume: c.volume > 0 ? c.volume : null,
      source: PSX_PRICE_SOURCE,
      updated_at: now,
    }));
    const { error } = await supabase
      .from("company_price_history")
      .upsert(chunk, { onConflict: "ticker,price_date" });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

function parseSymbols(): string[] {
  const idx = process.argv.indexOf("--symbols");
  if (idx === -1 || !process.argv[idx + 1]) return DEFAULT_SYMBOLS;
  return process.argv[idx + 1]
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function main() {
  const write = process.argv.includes("--write");
  const symbols = parseSymbols();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  console.log(`Backfilling index history for: ${symbols.join(", ")}\n`);

  for (const symbol of symbols) {
    const candles = await fetchPsxEod(symbol);
    if (candles.length === 0) {
      console.log(`  ${symbol.padEnd(8)} portal returned nothing (symbol may not be served); skipped.`);
      continue;
    }

    const portal = coverageOf(candles.map((c) => c.date));
    const before = coverageOf(await cachedDates(supabase, symbol));
    const cachedSet = new Set(await cachedDates(supabase, symbol));
    const newDates = candles.filter((c) => !cachedSet.has(c.date)).length;
    const withVolume = candles.filter((c) => c.volume > 0).length;

    console.log(`  ${symbol}`);
    console.log(`    portal : ${fmtCoverage(portal)}`);
    console.log(`    cached : ${fmtCoverage(before)}`);
    console.log(`    new    : ${newDates} date(s) not yet cached, ${withVolume}/${candles.length} carry volume`);

    if (!write) continue;

    const written = await writeCandles(supabase, symbol, candles);
    const after = coverageOf(await cachedDates(supabase, symbol));
    console.log(`    wrote  : ${written} row(s) upserted -> ${fmtCoverage(after)}`);
  }

  if (!write) {
    console.log("\nDry run only. Re-run with --write to persist to company_price_history.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
