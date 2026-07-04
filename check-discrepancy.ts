import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const userId = '25d76e66-8126-4849-9754-855d045d7ab8';
  
  // 1. Live Holdings from getPortfolio
  const { getPortfolio } = await import("./lib/portfolio.ts");
  const liveSummary = await getPortfolio(supabase, userId);
  const liveHoldings = new Map(liveSummary.holdings.map(h => [h.ticker, { qty: h.quantity, liveVal: h.market_value, livePrice: h.latest_price }]));

  // 2. EOD Holdings from buildBenchmarkSeries
  const { fetchEventsForUser } = await import("./lib/engine/allocation/data.ts");
  const { buildBenchmarkSeries } = await import("./lib/engine/benchmark-growth.ts");
  const { fetchPsxEod } = await import("./lib/market-data/fetch-psx-eod.ts");
  const { ensureEodCached, eodCache } = await import("./lib/market-data/eod-cache.ts");
  
  const { contributions, shareEvents, cashSeries } = await fetchEventsForUser(supabase, userId);
  const tickers = [...new Set(shareEvents.map(e => e.ticker))];
  await ensureEodCached(tickers);
  
  const priceSeries = new Map();
  for (const t of tickers) {
    priceSeries.set(t, await eodCache(t));
  }
  
  const kse100 = await eodCache('KSE100');
  const asOf = '2026-06-30';
  
  const eodHoldings = new Map();
  let eodTotal = 0;
  for (const e of shareEvents) {
    if (e.date > asOf) break;
    eodHoldings.set(e.ticker, (eodHoldings.get(e.ticker) ?? 0) + e.qtyDelta);
  }
  
  console.log(String("Ticker").padEnd(10), String("Live Val").padEnd(15), String("EOD Val").padEnd(15), String("Diff").padEnd(15));
  let liveT = 0, eodT = 0;
  
  const allTickers = new Set([...liveHoldings.keys(), ...eodHoldings.keys()]);
  for (const t of allTickers) {
    const live = liveHoldings.get(t);
    const eodQty = eodHoldings.get(t) || 0;
    
    let eodVal = 0;
    let eodPrice = 0;
    if (eodQty > 0) {
      const p = priceSeries.get(t);
      const row = p?.slice().reverse().find((r: any) => r.date <= asOf);
      eodPrice = row?.close || 0;
      eodVal = eodQty * eodPrice;
    }
    
    liveT += live?.liveVal || 0;
    eodT += eodVal;
    
    const diff = (live?.liveVal || 0) - eodVal;
    console.log(
      t.padEnd(10), 
      String((live?.liveVal || 0).toFixed(2)).padEnd(15), 
      String(eodVal.toFixed(2)).padEnd(15), 
      String(diff.toFixed(2)).padEnd(15)
    );
  }
  
  console.log("-".repeat(50));
  console.log("TOTALS".padEnd(10), String(liveT.toFixed(2)).padEnd(15), String(eodT.toFixed(2)).padEnd(15), String((liveT - eodT).toFixed(2)).padEnd(15));
}
run().catch(console.error);
