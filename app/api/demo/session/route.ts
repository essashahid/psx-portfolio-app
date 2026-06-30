import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadDemoData, DEMO_THREAD_COUNT } from "@/lib/demo";
import { LAUNCH_DEFAULT_FEATURES } from "@/lib/features";
import { errorResponse } from "@/lib/api-helpers";

export const maxDuration = 120;

export async function POST() {
  const email = process.env.DEMO_ACCOUNT_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_ACCOUNT_PASSWORD;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Demo account is not configured. Set DEMO_ACCOUNT_EMAIL and DEMO_ACCOUNT_PASSWORD." },
      { status: 503 }
    );
  }

  try {
    const supabase = await createClient();
    let result = await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      const admin = createAdminClient();
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: "PortfolioOS Demo" },
      });
      if (created.error && !/already|registered|exists/i.test(created.error.message)) {
        throw created.error;
      }
      result = await supabase.auth.signInWithPassword({ email, password });
    }

    if (result.error) throw result.error;
    const userId = result.data.user?.id;
    if (!userId) return NextResponse.json({ error: "Demo sign-in failed." }, { status: 500 });

    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({
        full_name: "PortfolioOS Demo",
        onboarded: true,
        demo_mode: true,
        enabled_features: [...LAUNCH_DEFAULT_FEATURES],
        allowed_llm_providers: [],
      })
      .eq("id", userId);

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
      await admin
        .from("profiles")
        .update({
          full_name: "PortfolioOS Demo",
          onboarded: true,
          demo_mode: true,
          enabled_features: [...LAUNCH_DEFAULT_FEATURES],
          allowed_llm_providers: [],
        })
        .eq("id", userId);
    }

    return NextResponse.json({ ok: true, redirectTo: "/dashboard" });
  } catch (err) {
    return errorResponse(err);
  }
}
