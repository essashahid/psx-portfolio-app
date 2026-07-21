// Rebuilds market_breadth_history from the cached EOD price panel.
//
// Run after scripts/backfill-universe-eod.ts has deepened the universe. Breadth
// is derived, not captured, so this is safe to re-run at any time: it recomputes
// every day from prices and upserts the result.
//
//   npx tsx scripts/build-market-breadth.ts              # dry run, reports coverage
//   npx tsx scripts/build-market-breadth.ts --write
//   npx tsx scripts/build-market-breadth.ts --write --from 2024-01-01

import { config } from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeBreadth, type BreadthDay, type PricePanel } from "@/lib/engine/outlook/breadth";

config({ path: resolve(process.cwd(), ".env.local") });

/** Index symbols are not constituents and must not be counted as breadth members. */
const INDEX_SYMBOLS = new Set(["KSE100", "KSE30", "KMI30", "ALLSHR"]);

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

/**
 * Load the whole price panel. This is a large read (hundreds of thousands of
 * rows), so it pages explicitly rather than trusting a default limit.
 */
async function loadPanel(supabase: SupabaseClient, from: string): Promise<PricePanel> {
  const PAGE = 1000;
  const panel: PricePanel = new Map();
  let scanned = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("ticker, price_date, close, volume")
      .gte("price_date", from)
      .order("ticker", { ascending: true })
      .order("price_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const ticker = r.ticker as string;
      if (INDEX_SYMBOLS.has(ticker)) continue;
      const close = Number(r.close);
      if (!Number.isFinite(close) || close <= 0) continue;
      const list = panel.get(ticker) ?? [];
      list.push({
        date: r.price_date as string,
        close,
        volume: r.volume === null ? null : Number(r.volume),
      });
      panel.set(ticker, list);
    }
    scanned += rows.length;
    if (scanned % 50000 === 0) console.log(`  ...read ${scanned.toLocaleString()} rows`);
    if (rows.length < PAGE) break;
  }
  return panel;
}

/** Trading days from the index, the authoritative session calendar. */
async function tradingDays(supabase: SupabaseClient, from: string): Promise<string[]> {
  const PAGE = 1000;
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("company_price_history")
      .select("price_date")
      .eq("ticker", "KSE100")
      .gte("price_date", from)
      .order("price_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows.map((r) => r.price_date as string));
    if (rows.length < PAGE) break;
  }
  return out;
}

async function writeBreadth(supabase: SupabaseClient, days: BreadthDay[]): Promise<number> {
  const CHUNK = 500;
  const now = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < days.length; i += CHUNK) {
    const chunk = days.slice(i, i + CHUNK).map((d) => ({ ...d, computed_at: now }));
    const { error } = await supabase
      .from("market_breadth_history")
      .upsert(chunk, { onConflict: "trade_date" });
    if (error) throw error;
    written += chunk.length;
  }
  return written;
}

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

async function main() {
  const write = process.argv.includes("--write");
  const from = arg("from") ?? "2021-01-01";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  console.log(`Loading price panel from ${from}...`);
  const panel = await loadPanel(supabase, from);
  const totalPoints = [...panel.values()].reduce((a, b) => a + b.length, 0);
  console.log(`Panel: ${panel.size} symbols, ${totalPoints.toLocaleString()} closes.`);

  const days = await tradingDays(supabase, from);
  console.log(`Trading days: ${days.length}`);

  console.log("Computing breadth...");
  const breadth = computeBreadth(panel, days);

  const withCount = breadth.filter((b) => b.counted >= 50);
  console.log(`\nComputed ${breadth.length} day(s); ${withCount.length} with 50+ symbols counted.`);
  if (breadth.length) {
    const first = breadth[0];
    const last = breadth[breadth.length - 1];
    const avgCounted = Math.round(breadth.reduce((a, b) => a + b.counted, 0) / breadth.length);
    console.log(`  range   : ${first.trade_date} -> ${last.trade_date}`);
    console.log(`  avg symbols counted per day: ${avgCounted}`);
    console.log(`\n  sample (latest): ${last.trade_date}`);
    console.log(`    ${last.advancers} up / ${last.decliners} down / ${last.unchanged} flat of ${last.counted}`);
    console.log(`    advance share ${pct(last.advance_share)}, above 50d ${pct(last.pct_above_ma50)}, above 200d ${pct(last.pct_above_ma200)}`);
    console.log(`    new highs ${last.new_highs_52w ?? "n/a"}, new lows ${last.new_lows_52w ?? "n/a"}, dispersion ${pct(last.return_dispersion)}`);
  }

  if (!write) {
    console.log("\nDry run. Re-run with --write to persist to market_breadth_history.");
    return;
  }

  const written = await writeBreadth(supabase, breadth);
  console.log(`\nWrote ${written} breadth row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
