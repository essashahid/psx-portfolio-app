import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lightweight per-user UI state stored in profiles.prefs (jsonb). This is for
 * small, sparse, owner-only values that do not warrant dedicated columns:
 * last-seen timestamps per surface, dismissed dashboard checks, and similar.
 */
export type UserPrefs = {
  news_last_seen_at?: string;
  dashboard_last_seen_at?: string;
  /** Map of check id -> ISO timestamp the user dismissed it at. */
  dismissed_checks?: Record<string, string>;
  [key: string]: unknown;
};

export async function getPrefs(supabase: SupabaseClient, userId: string): Promise<UserPrefs> {
  const { data } = await supabase.from("profiles").select("prefs").eq("id", userId).maybeSingle();
  const prefs = (data?.prefs ?? {}) as UserPrefs;
  return prefs && typeof prefs === "object" ? prefs : {};
}

/** Shallow-merge a patch into profiles.prefs. No-op semantics for the demo account are enforced by RLS. */
export async function setPrefs(supabase: SupabaseClient, userId: string, patch: Partial<UserPrefs>): Promise<void> {
  const current = await getPrefs(supabase, userId);
  const next = { ...current, ...patch };
  await supabase.from("profiles").update({ prefs: next }).eq("id", userId);
}
