import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: holders } = await supabase.from("holdings").select("user_id").gt("quantity", 0);
  if (!holders) return;
  const userIds = [...new Set(holders.map((h) => String(h.user_id)))];
  
  for (const userId of userIds) {
    const { data: series } = await supabase
      .from("benchmark_series")
      .select("*")
      .eq("user_id", userId)
      .order("point_date", { ascending: false })
      .limit(1);
    
    console.log(`Latest benchmark for user ${userId}:`, series);
  }
}
run();
