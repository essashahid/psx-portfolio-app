import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const tables = ["stock_universe", "provider_symbol_map", "market_quotes", "company_ratios", "data_provider_status", "company_metadata", "company_technicals", "company_financials", "company_price_history", "stock_watchlist", "data_fetch_logs", "holdings"];
async function main() {
  for (const t of tables) {
    const { error } = await db.from(t).select("*").limit(1);
    console.log(t.padEnd(24), error ? `MISSING (${error.code})` : "EXISTS");
  }
}
main();
