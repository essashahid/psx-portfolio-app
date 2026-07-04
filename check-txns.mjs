import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "fallback";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: users } = await supabase.from("profiles").select("id, email").eq("email", "eessashahid@gmail.com");
  // The user might be 'shahid@crescentcotton.com' if eessashahid is not found.
  const userId = '25d76e66-8126-4849-9754-855d045d7ab8'; // User from previous dump that matched 1,271,890.44

  const { data: txns } = await supabase.from("transactions").select("*").eq("user_id", userId).order("trade_date", { ascending: false }).limit(5);
  console.log("Recent txns:", txns);
}
run();
