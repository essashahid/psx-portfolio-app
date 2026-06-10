import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function requireUser(): Promise<
  { supabase: SupabaseClient; user: User; error: null } | { supabase: null; user: null; error: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase: null,
      user: null,
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  return { supabase, user, error: null };
}

export function errorResponse(err: unknown, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : "Something went wrong";
  return NextResponse.json({ error: message }, { status });
}

export async function logAgentRun(
  supabase: SupabaseClient,
  userId: string,
  agentType: string,
  input: Record<string, unknown>,
  run: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
  const { data: row } = await supabase
    .from("agent_runs")
    .insert({ user_id: userId, agent_type: agentType, input, status: "running" })
    .select("id")
    .single();
  try {
    const output = await run();
    if (row) {
      await supabase
        .from("agent_runs")
        .update({ status: "success", output, finished_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    return output;
  } catch (err) {
    if (row) {
      await supabase
        .from("agent_runs")
        .update({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          finished_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
    throw err;
  }
}
