import type { SupabaseClient } from "@supabase/supabase-js";
import { track } from "@vercel/analytics/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadDemoData, DEMO_THREAD_COUNT } from "@/lib/demo/seed";
import { LAUNCH_DEFAULT_FEATURES } from "@/lib/config/features";

const DEMO_PROFILE = {
  full_name: "PortfolioOS Demo",
  onboarded: true,
  demo_mode: true,
  enabled_features: [...LAUNCH_DEFAULT_FEATURES],
  allowed_llm_providers: [] as string[],
};

export type DemoSessionResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Signs the caller into the shared read-only demo workspace, creating the
 * account and seeding it on first use. `supabase` must be a server client
 * whose cookie writer targets the response being returned, so the session
 * cookies actually reach the browser.
 */
export async function startDemoSession(supabase: SupabaseClient): Promise<DemoSessionResult> {
  const email = process.env.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_ACCOUNT_PASSWORD;

  if (!email || !password) {
    return {
      ok: false,
      status: 503,
      error: "Demo account is not configured. Set DEMO_ACCOUNT_EMAIL and DEMO_ACCOUNT_PASSWORD.",
    };
  }

  let result = await supabase.auth.signInWithPassword({ email, password });

  if (result.error) {
    const admin = createAdminClient();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: DEMO_PROFILE.full_name },
    });
    if (created.error && !/already|registered|exists/i.test(created.error.message)) {
      throw created.error;
    }
    result = await supabase.auth.signInWithPassword({ email, password });
  }

  if (result.error) throw result.error;
  const userId = result.data.user?.id;
  if (!userId) return { ok: false, status: 500, error: "Demo sign-in failed." };

  const admin = createAdminClient();
  await admin.from("profiles").update(DEMO_PROFILE).eq("id", userId);

  const [{ count: holdingCount }, { count: threadCount }] = await Promise.all([
    admin
      .from("holdings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "demo"),
    admin
      .from("chat_threads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .like("summary", "Demo library:%"),
  ]);
  if (!holdingCount || (threadCount ?? 0) < DEMO_THREAD_COUNT) {
    await loadDemoData(admin, userId);
    await admin.from("profiles").update(DEMO_PROFILE).eq("id", userId);
  }

  // The launch metric that matters: someone actually opened the demo.
  // Server-side so it can't be blocked; never let analytics break login.
  await track("demo_started").catch(() => {});

  return { ok: true };
}
