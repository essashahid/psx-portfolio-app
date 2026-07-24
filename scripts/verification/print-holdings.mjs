import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlZmF1bHQiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY3ODYyMzc0NywiZXhwIjo0ODMzMjIzNzQ3fQ.0";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: holdings } = await supabase.from("holdings").select("*");
  console.log("Holdings:", JSON.stringify(holdings, null, 2));

  const tickers = holdings ? Array.from(new Set(holdings.map(h => h.ticker))) : ["CCM"];
  const { data: quotes } = await supabase.from("market_quotes").select("*").in("ticker", tickers);
  console.log("Live quotes:", JSON.stringify(quotes, null, 2));
}

run();
