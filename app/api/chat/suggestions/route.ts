import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-helpers";
import { accountHasFeature } from "@/lib/features";
import { isDemoAccount } from "@/lib/demo-mode";
import { getCachedSuggestions, refreshSuggestions } from "@/lib/chat/suggest";

export const maxDuration = 60;

/**
 * Personalized Copilot suggestions. GET returns the cached pool and, when the
 * cache is stale or the portfolio/question history changed, regenerates it
 * inline (a single V4 Flash call, a few seconds). The client calls this after
 * the empty state has already painted with the cached or deterministic pool,
 * so generation latency is never on the render path.
 */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  if (!(await accountHasFeature(supabase, user.id, "/chat"))) {
    return NextResponse.json({ error: "Research Copilot is disabled for this account." }, { status: 403 });
  }
  // The shared demo account is read-only and shows curated threads instead.
  if (await isDemoAccount(supabase, user.id)) {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const fresh = await refreshSuggestions(supabase, user.id);
    return NextResponse.json({ suggestions: fresh?.suggestions ?? [], generatedAt: fresh?.generatedAt ?? null });
  } catch {
    // Never break the empty state over suggestions — fall back to the cache.
    const cached = await getCachedSuggestions(supabase, user.id).catch(() => null);
    return NextResponse.json({ suggestions: cached?.suggestions ?? [], generatedAt: cached?.generatedAt ?? null });
  }
}
