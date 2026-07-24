import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlZmF1bHQiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY3ODYyMzc0NywiZXhwIjo0ODMzMjIzNzQ3fQ.0";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Triggering recompute for all active users...");
  const { data: holders } = await supabase.from("holdings").select("user_id").gt("quantity", 0);
  if (!holders) {
    console.log("No holders found.");
    return;
  }
  const userIds = [...new Set(holders.map((h) => String(h.user_id)))];
  console.log("Found active users:", userIds);

  for (const userId of userIds) {
    console.log(`Hitting rebuild endpoint for user: ${userId}`);
    const res = await fetch(`http://127.0.0.1:3000/api/portfolio/rebuild`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, changedTickers: [] })
    });
    console.log(`Rebuild response: ${res.status}`);
  }
}
run();
