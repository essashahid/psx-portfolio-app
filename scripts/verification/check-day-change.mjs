import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const userId = '25d76e66-8126-4849-9754-855d045d7ab8';

  const { data: holdings } = await supabase.from("holdings").select("ticker, quantity, avg_cost, total_cost").eq("user_id", userId);
  
  const { data: quotes } = await supabase.from("market_quotes").select("ticker, price, prev_close, day_change");
  const quoteMap = new Map((quotes || []).map(p => [p.ticker, p]));
  
  let dayGain = 0;
  for (const h of holdings || []) {
    const q = quoteMap.get(h.ticker);
    if (!q) continue;
    const change = Number(q.day_change);
    const pnl = h.quantity * change;
    dayGain += pnl;
    console.log(`${h.ticker.padEnd(10)} | Qty: ${String(h.quantity).padEnd(6)} | Change: ${String(change).padEnd(8)} | PnL: ${pnl.toFixed(2)}`);
  }
  console.log("Total Day Gain:", dayGain.toFixed(2));
}
run();
