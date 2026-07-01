/**
 * Re-seed the shared read-only demo account with the current lib/demo.ts data.
 *
 * Read-only report (default):
 *   npx tsx scripts/reseed-demo.ts
 * Actually clear + reseed the demo account:
 *   npx tsx scripts/reseed-demo.ts --write
 *
 * The demo account is found by DEMO_ACCOUNT_EMAIL when set, otherwise by the
 * single profile with demo_mode = true.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { loadDemoData, DEMO_THREAD_COUNT } from "@/lib/demo";

async function main() {
  const write = process.argv.includes("--write");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Locate the demo user.
  const email = process.env.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase();
  let userId: string | null = null;
  let foundBy = "";

  if (email) {
    // Page through auth users to find the demo email.
    for (let page = 1; page <= 20 && !userId; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const match = data.users.find((u) => u.email?.toLowerCase() === email);
      if (match) { userId = match.id; foundBy = `DEMO_ACCOUNT_EMAIL (${email})`; }
      if (data.users.length < 200) break;
    }
  }

  if (!userId) {
    const { data, error } = await admin.from("profiles").select("id, full_name, demo_mode").eq("demo_mode", true);
    if (error) throw error;
    if (!data?.length) throw new Error("No demo account found (no DEMO_ACCOUNT_EMAIL match and no profile with demo_mode = true).");
    if (data.length > 1) {
      console.log("Multiple demo_mode profiles found:", data.map((p) => `${p.id} (${p.full_name ?? "?"})`).join(", "));
      throw new Error("More than one demo_mode profile. Set DEMO_ACCOUNT_EMAIL to disambiguate.");
    }
    userId = data[0].id as string;
    foundBy = "profiles.demo_mode = true";
  }

  console.log(`Demo user: ${userId}  [found by ${foundBy}]`);

  const [holdings, threads, dividends, snapshots, benchmarks, events] = await Promise.all([
    admin.from("holdings").select("ticker", { count: "exact", head: true }).eq("user_id", userId).eq("source", "demo"),
    admin.from("chat_threads").select("id", { count: "exact", head: true }).eq("user_id", userId).like("summary", "Demo library:%"),
    admin.from("dividends").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("source", "demo"),
    admin.from("portfolio_snapshots").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("benchmark_series").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin.from("dividend_events").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  console.log("Current demo data:");
  console.log(`  holdings (demo):     ${holdings.count ?? 0}`);
  console.log(`  chat threads:        ${threads.count ?? 0}  (target ${DEMO_THREAD_COUNT})`);
  console.log(`  dividends (demo):    ${dividends.count ?? 0}`);
  console.log(`  portfolio snapshots: ${snapshots.count ?? 0}`);
  console.log(`  benchmark points:    ${benchmarks.count ?? 0}`);
  console.log(`  dividend events:     ${events.count ?? 0}`);

  if (!write) {
    console.log("\nRead-only report. Re-run with --write to clear and reseed with the new dataset.");
    return;
  }

  console.log("\nReseeding with the current lib/demo.ts dataset...");
  await loadDemoData(admin, userId);

  const [h2, t2] = await Promise.all([
    admin.from("holdings").select("ticker", { count: "exact", head: true }).eq("user_id", userId).eq("source", "demo"),
    admin.from("chat_threads").select("id", { count: "exact", head: true }).eq("user_id", userId).like("summary", "Demo library:%"),
  ]);
  console.log(`Done. Now: ${h2.count ?? 0} holdings, ${t2.count ?? 0} curated threads.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
