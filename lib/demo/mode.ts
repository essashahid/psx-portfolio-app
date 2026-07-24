import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function isDemoAccount(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("demo_mode")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.demo_mode);
}

export async function rejectDemoWrite(
  supabase: SupabaseClient,
  userId: string,
  message = "The demo workspace is read-only."
): Promise<NextResponse | null> {
  return (await isDemoAccount(supabase, userId))
    ? NextResponse.json({ error: message }, { status: 403 })
    : null;
}
