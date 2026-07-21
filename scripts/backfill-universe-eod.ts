// Deep-backfills daily EOD history for the whole PSX equity universe.
//
// This is the prerequisite for reconstructing market breadth. PSX publishes no
// historical advance/decline endpoint, but breadth is not a separate dataset:
// it is a count over constituent prices, and the portal does serve five years
// of EOD per individual symbol. Fetch every constituent and the whole breadth
// history falls out of prices we can already reach.
//
// Suspended and delisted symbols are included deliberately. Counting only
// today's survivors would bias every historical day toward companies that
// happened to make it, which is exactly the survivorship error that flatters a
// backtest.
//
//   npx tsx scripts/backfill-universe-eod.ts                    # dry run
//   npx tsx scripts/backfill-universe-eod.ts --write
//   npx tsx scripts/backfill-universe-eod.ts --write --limit 50 # partial pass
//   npx tsx scripts/backfill-universe-eod.ts --write --min-rows 1200

import { config } from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchPsxEod, PSX_PRICE_SOURCE, type EodCandle } from "@/lib/market-data/psx-dps";

config({ path: resolve(process.cwd(), ".env.local") });

/**
 * Symbols fetched at once. Matches the batch size psx-dps.ts already uses
 * against this portal, which is the established safe level for its WAF.
 */
const CONCURRENCY = 5;
/** Gap between batches. The portal is a courtesy source, not an API. */
const BATCH_SPACING_MS = 150;
/**
 * Rows buffered before a write. Upserting each symbol separately made the
 * database round trip, not the portal, the bottleneck: ~1,200 rows per symbol
 * meant a request per symbol. Batching across symbols amortises that.
 */
const WRITE_BUFFER_ROWS = 4000;
/** Symbols with at least this much history are treated as already deep. */
const DEEP_ENOUGH_ROWS = 1200;
/**
 * Earliest date the portal serves. A symbol already cached back to here is
 * complete even with far fewer rows than a full-history name, which is the
 * normal case for anything suspended or delisted partway through the window.
 * Without this, every such symbol is refetched on every run forever.
 */
const PORTAL_START = "2021-08-15";

/**
 * Instrument types that belong in a breadth count. Debt, rights and preference
 * lines trade too thinly and too erratically to say anything about the mood of
 * the equity market, and would add noise to every advance/decline reading.
 */
const BREADTH_INSTRUMENTS = ["equity", "modaraba", "fund"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function universeTickers(supabase: SupabaseClient): Promise<{ ticker: string; status: string }[]> {
  const PAGE = 1000;
  const out: { ticker: string; status: string }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("stock_universe")
      .select("ticker, instrument_type, listing_status")
      .in("instrument_type", BREADTH_INSTRUMENTS)
      .order("ticker", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows.map((r) => ({ ticker: r.ticker as string, status: (r.listing_status as string) ?? "unknown" })));
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Row count and earliest cached date per ticker. Both are needed to decide
 * whether a symbol still needs fetching: a high count means deep history, and
 * an early first date means complete history even when the count is low.
 */
async function cachedState(supabase: SupabaseClient): Promise<Map<string, { rows: number; firstDate: string }>> {
  const PAGE = 1000;
  const state = new Map<string, { rows: number; firstDate: string }>();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("ticker, price_date")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const ticker = r.ticker as string;
      const date = r.price_date as string;
      const prev = state.get(ticker);
      if (!prev) state.set(ticker, { rows: 1, firstDate: date });
      else state.set(ticker, { rows: prev.rows + 1, firstDate: date < prev.firstDate ? date : prev.firstDate });
    }
    if (rows.length < PAGE) break;
  }
  return state;
}

/** One candle per trade date; the portal can return two stamps on one PKT day. */
function dedupeByDate(candles: EodCandle[]): EodCandle[] {
  const byDate = new Map<string, EodCandle>();
  for (const c of candles) byDate.set(c.date, c);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

interface PriceRow {
  ticker: string;
  price_date: string;
  close: number;
  volume: number | null;
  source: string;
  updated_at: string;
}

function toRows(ticker: string, input: EodCandle[]): PriceRow[] {
  const now = new Date().toISOString();
  return dedupeByDate(input).map((c) => ({
    ticker,
    price_date: c.date,
    close: c.close,
    volume: c.volume > 0 ? c.volume : null,
    source: PSX_PRICE_SOURCE,
    updated_at: now,
  }));
}

/** Flush buffered rows in chunks. Rows are already unique per (ticker, date). */
async function flush(supabase: SupabaseClient, buffer: PriceRow[]): Promise<number> {
  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    const chunk = buffer.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("company_price_history")
      .upsert(chunk, { onConflict: "ticker,price_date" });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

async function main() {
  const write = process.argv.includes("--write");
  const limit = Number(arg("limit") ?? "0") || Infinity;
  const minRows = Number(arg("min-rows") ?? String(DEEP_ENOUGH_ROWS));

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const universe = await universeTickers(supabase);
  const state = await cachedState(supabase);
  // Complete means either deep enough, or already reaching back to the start of
  // the portal's window (a symbol that stopped trading in 2023 is complete at
  // 400 rows and should not be refetched on every run).
  const shallow = universe.filter((u) => {
    const s = state.get(u.ticker);
    if (!s) return true;
    return s.rows < minRows && s.firstDate > PORTAL_START;
  });
  const todo = shallow.slice(0, limit);

  const byStatus = universe.reduce<Record<string, number>>((acc, u) => {
    acc[u.status] = (acc[u.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Universe (${BREADTH_INSTRUMENTS.join(", ")}): ${universe.length}`);
  console.log(`  by listing status: ${JSON.stringify(byStatus)}`);
  console.log(`Already at ${minRows}+ rows: ${universe.length - shallow.length}`);
  console.log(`To fetch: ${todo.length}${limit !== Infinity ? " (limited)" : ""}`);

  if (!write) {
    console.log(`\nDry run. Re-run with --write to fetch and persist.`);
    const perBatchMs = BATCH_SPACING_MS + 900; // spacing plus a typical portal round trip
    console.log(
      `Estimated wall time if written: ~${Math.max(1, Math.round((Math.ceil(todo.length / CONCURRENCY) * perBatchMs) / 60000))} min at ${CONCURRENCY} concurrent`
    );
    return;
  }

  const started = Date.now();
  let deepened = 0;
  let empty = 0;
  let rows = 0;
  let processed = 0;
  let buffer: PriceRow[] = [];

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (u) => {
        try {
          return { ticker: u.ticker, candles: await fetchPsxEod(u.ticker) };
        } catch {
          return { ticker: u.ticker, candles: [] as EodCandle[] };
        }
      })
    );

    for (const r of results) {
      processed++;
      if (r.candles.length === 0) {
        empty++;
        continue;
      }
      buffer.push(...toRows(r.ticker, r.candles));
      deepened++;
    }

    if (buffer.length >= WRITE_BUFFER_ROWS) {
      rows += await flush(supabase, buffer);
      buffer = [];
    }

    const elapsed = (Date.now() - started) / 1000;
    const rate = processed / elapsed;
    const remaining = rate > 0 ? Math.round((todo.length - processed) / rate / 60) : 0;
    console.log(
      `  ${processed}/${todo.length}  deepened ${deepened}  empty ${empty}  rows ${rows.toLocaleString()}  (${rate.toFixed(1)}/s, ~${remaining}m left)`
    );

    await sleep(BATCH_SPACING_MS);
  }

  if (buffer.length) rows += await flush(supabase, buffer);

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nDone in ${mins}m. Deepened ${deepened} symbol(s), ${rows.toLocaleString()} rows upserted, ${empty} returned nothing.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
