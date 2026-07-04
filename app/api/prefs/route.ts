import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { rejectDemoWrite } from "@/lib/demo-mode";
import { getPrefs, setPrefs, type UserPrefs } from "@/lib/prefs";

const ALLOWED_KEYS = new Set<keyof UserPrefs>([
  "news_last_seen_at",
  "dashboard_last_seen_at",
  "dismissed_checks",
]);

/** Merge a small patch into the caller's profiles.prefs. Owner-only, non-demo. */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const body = (await request.json().catch(() => ({}))) as Partial<UserPrefs>;
    const patch: Partial<UserPrefs> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_KEYS.has(key as keyof UserPrefs)) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, reason: "no valid keys" });

    // dismissed_checks is a growing map, so merge it into the existing value
    // rather than replacing it and losing prior dismissals.
    if (patch.dismissed_checks) {
      const current = await getPrefs(supabase, user.id);
      patch.dismissed_checks = { ...(current.dismissed_checks ?? {}), ...patch.dismissed_checks };
    }

    await setPrefs(supabase, user.id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
