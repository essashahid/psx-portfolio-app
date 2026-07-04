import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const userId = '25d76e66-8126-4849-9754-855d045d7ab8';
  
  // 1. holdings
  const { data: holdings } = await supabase.from("holdings").select("ticker, quantity").eq("user_id", userId);
  
  // 2. shareEvents
  const { fetchEventsForUser } = await import("./lib/engine/allocation/data.ts");
  const { shareEvents } = await fetchEventsForUser(supabase, userId);
  const qtyByTicker = new Map<string, number>();
  for (const e of shareEvents) {
    if (e.date > '2026-06-30') break; // EOD date
    qtyByTicker.set(e.ticker, (qtyByTicker.get(e.ticker) ?? 0) + e.qtyDelta);
  }
  
  console.log("Ticker | Holdings Table Qty | Benchmark Event Qty");
  for (const h of holdings || []) {
    const bQty = qtyByTicker.get(h.ticker) || 0;
    if (h.quantity !== bQty) {
      console.log(`${h.ticker} | ${h.quantity} | ${bQty}`);
    }
  }
}
run().catch(console.error);
