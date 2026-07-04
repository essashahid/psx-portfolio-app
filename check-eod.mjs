import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const userId = '25d76e66-8126-4849-9754-855d045d7ab8';

  const { data: holdings } = await supabase.from("holdings").select("ticker, quantity").eq("user_id", userId);
  const qtyMap = new Map(holdings.map(h => [h.ticker, h.quantity]));
  
  const { data: eodPrices } = await supabase.from("eod_history").select("ticker, close").eq("date", "2026-06-30");
  const eodMap = new Map((eodPrices || []).map(p => [p.ticker, p.close]));
  
  let eodTotal = 0;
  for (const [ticker, qty] of qtyMap) {
    const p = eodMap.get(ticker) || 0;
    const val = qty * p;
    eodTotal += val;
    console.log(`${ticker.padEnd(10)} | Qty: ${String(qty).padEnd(6)} | Price: ${String(p).padEnd(8)} | Val: ${val.toFixed(2)}`);
  }
  console.log("EOD Holdings Total:", eodTotal.toFixed(2));
}
run();
