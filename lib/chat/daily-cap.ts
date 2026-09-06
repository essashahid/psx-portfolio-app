import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-user daily message cap for Ask. Counted from the user's own rows in
 * chat_messages (role "user") since midnight UTC, so the count survives
 * restarts and needs no extra table. Admins are exempt at the call site.
 */

export const DAILY_MESSAGE_CAP = 40;

export const DAILY_CAP_MESSAGE = `You have used today's ${DAILY_MESSAGE_CAP} questions. The limit resets at midnight UTC.`;

/** Start of the current UTC day as an ISO timestamp. */
export function utcDayStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** How many questions this user has asked so far today (UTC). */
export async function countMessagesToday(supabase: SupabaseClient, userId: string, now: Date = new Date()): Promise<number> {
  const { count, error } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", utcDayStart(now));
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export function overDailyCap(count: number): boolean {
  return count >= DAILY_MESSAGE_CAP;
}
