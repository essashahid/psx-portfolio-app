import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const userId = '25d76e66-8126-4849-9754-855d045d7ab8';
  const { data: cash } = await supabase.from("cash_movements").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(5);
  console.log("Recent cash:", cash);
}
run();
