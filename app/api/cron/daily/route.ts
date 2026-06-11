import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyUpdate } from "@/lib/dividends/daily";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily scheduled update for every user.
 *
 * Triggered by a scheduled job (Vercel Cron, an OS cron `curl`, or Supabase
 * pg_cron). Protected by CRON_SECRET — the caller must send it either as
 * `Authorization: Bearer <secret>` (Vercel Cron style) or `?key=<secret>`.
 * Runs the proactive dividend/price/forecast/reconcile pipeline per user and
 * writes each user's "what changed" digest.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 503 }
    );
  }
  const url = new URL(request.url);
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Users who actually hold something — no point scanning empty accounts.
  const { data: holders, error } = await admin.from("holdings").select("user_id").gt("quantity", 0);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const userIds = [...new Set((holders ?? []).map((h) => String(h.user_id)))];

  const results: { user_id: string; ok: boolean; highlights?: string[]; error?: string }[] = [];
  for (const userId of userIds) {
    try {
      const summary = await runDailyUpdate(admin, userId);
      results.push({ user_id: userId, ok: true, highlights: summary.highlights });
    } catch (e) {
      results.push({ user_id: userId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    run_date: new Date().toISOString().slice(0, 10),
    users_processed: results.length,
    results,
  });
}
