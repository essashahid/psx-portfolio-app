// Chat grounding eval: assembles the real <context> brief for a set of
// representative questions and checks it carries the data points a great answer
// needs. Fast, free, deterministic (no LLM) — run it in CI or before shipping a
// prompt/pipeline change to stop quality drifting silently.
//
//   EVAL_USER_ID=<uuid> npx tsx scripts/eval-chat.ts
//   npx tsx scripts/eval-chat.ts            # falls back to the demo user
//
// Exits non-zero if any case fails a `must`/`mustNot` check.

import { config } from "dotenv";
import { resolve } from "path";
import { createAdminClient } from "@/lib/supabase/admin";
import { runEvals, formatReport } from "@/lib/chat/evals/harness";

config({ path: resolve(process.cwd(), ".env.local") });

async function resolveUserId(supabase: ReturnType<typeof createAdminClient>): Promise<string | null> {
  if (process.env.EVAL_USER_ID) return process.env.EVAL_USER_ID;
  // Prefer a demo account (it always has a seeded portfolio).
  const { data: demo } = await supabase.from("profiles").select("id").eq("demo_mode", true).limit(1).maybeSingle();
  if (demo?.id) return demo.id as string;
  // Otherwise the first user that actually holds something.
  const { data: holder } = await supabase.from("holdings").select("user_id").gt("quantity", 0).limit(1).maybeSingle();
  return (holder?.user_id as string) ?? null;
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set them in .env.local).");
    process.exit(2);
  }
  const supabase = createAdminClient();
  const userId = await resolveUserId(supabase);
  if (!userId) {
    console.error("No user with holdings found. Set EVAL_USER_ID to a seeded account.");
    process.exit(2);
  }

  const report = await runEvals(supabase, userId);
  console.log(formatReport(report));
  if (report.failed > 0) {
    console.error(`\n${report.failed} case(s) failed a critical check.`);
    process.exit(1);
  }
  console.log(`\nAll ${report.total} cases passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
