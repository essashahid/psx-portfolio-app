// Live-answer eval: generates a real model answer per case from the production
// system prompt + brief, then scores the answer for hedging, em dashes, missing
// figures, and numeric fidelity (numbers that do not trace back to the brief).
// Calls the LLM, so it costs tokens — run it on demand before shipping a prompt,
// pipeline, or model change, not in CI on every commit.
//
//   EVAL_USER_ID=<uuid> npx tsx scripts/eval-chat-live.ts
//   EVAL_MODEL=claude-sonnet npx tsx scripts/eval-chat-live.ts
//
// Defaults to the demo user and the DeepSeek V4 Flash model. Exits non-zero if
// any case fails.

import { config } from "dotenv";
import { resolve } from "path";
import { createAdminClient } from "@/lib/supabase/admin";
import { runLiveEvals, formatLiveReport } from "@/lib/chat/evals/live";

config({ path: resolve(process.cwd(), ".env.local") });

const DEFAULT_MODEL = "deepseek-flash";

async function resolveUserId(supabase: ReturnType<typeof createAdminClient>): Promise<string | null> {
  if (process.env.EVAL_USER_ID) return process.env.EVAL_USER_ID;
  const { data: demo } = await supabase.from("profiles").select("id").eq("demo_mode", true).limit(1).maybeSingle();
  if (demo?.id) return demo.id as string;
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
  const model = process.env.EVAL_MODEL || DEFAULT_MODEL;

  const report = await runLiveEvals(supabase, userId, model);
  console.log(formatLiveReport(report));
  if (report.failed > 0) {
    console.error(`\n${report.failed}/${report.total} case(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${report.total} cases passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
