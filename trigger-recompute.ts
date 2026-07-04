import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: holders } = await supabase.from("holdings").select("user_id").gt("quantity", 0);
  if (!holders) {
    console.log("No holders found.");
    return;
  }
  const userIds = [...new Set(holders.map((h) => String(h.user_id)))];
  
  const { rebuildBenchmarkSeries } = await import("./lib/engine/benchmark-rebuild.ts");
  const { ensureEodCached } = await import("./lib/market-data/eod-cache.ts");

  for (const userId of userIds) {
    console.log(`Rebuilding benchmark for (${userId})...`);
    
    const { data: tickerRows } = await supabase
      .from("transactions")
      .select("ticker")
      .eq("user_id", userId);
    const tickers = [...new Set((tickerRows ?? []).map((r) => r.ticker as string).filter(Boolean))];
    
    console.log("Tickers:", tickers);
    if (tickers.length > 0) {
      await ensureEodCached(tickers);
      const res = await rebuildBenchmarkSeries(supabase, userId);
      console.log("Rebuild result:", res);
    }
  }
}
run().catch(console.error);
