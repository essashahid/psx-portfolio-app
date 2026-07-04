import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const userId = '25d76e66-8126-4849-9754-855d045d7ab8';

  const { data: holdings } = await supabase.from("holdings").select("ticker, quantity, avg_cost, total_cost").eq("user_id", userId);
  
  const { data: prices } = await supabase.rpc("latest_prices", { p_user_id: userId, p_tickers: holdings.map(h => h.ticker) });
  const priceMap = new Map((prices || []).map(p => [p.ticker, p.price]));
  
  let liveTotal = 0;
  for (const h of holdings || []) {
    const p = priceMap.get(h.ticker) || h.avg_cost;
    const val = h.quantity * p;
    liveTotal += val;
    console.log(`${h.ticker.padEnd(10)} | Qty: ${String(h.quantity).padEnd(6)} | Price: ${String(p).padEnd(8)} | Val: ${val.toFixed(2)}`);
  }
  console.log("Live Holdings Total:", liveTotal.toFixed(2));
}
run();
