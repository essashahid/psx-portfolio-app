import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { bearerTokenFrom, createBearerClient } from "@/lib/supabase/bearer";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const IMPERSONATE_COOKIE = "x_admin_impersonate";

function notAuthenticated(): NextResponse {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

/**
 * The caller for this request, from either credential the platform issues.
 *
 * The web app sends session cookies. The mobile app has no cookie jar, so it
 * sends the same Supabase access token as an `Authorization: Bearer` header.
 * Both end up as a client scoped to that user, so the ~57 routes calling this
 * did not have to change, and RLS is what enforces access in both cases.
 *
 * Admin impersonation stays cookie-only on purpose: it is a web debugging tool,
 * and the bearer path should never let a token stand in for another account.
 *
 * The cron routes read `Authorization` for their own shared secret and check it
 * before reaching here, so a user token cannot satisfy a cron check and a cron
 * secret cannot satisfy this one.
 */
export async function requireUser(): Promise<
  { supabase: SupabaseClient; user: User; error: null } | { supabase: null; user: null; error: NextResponse }
> {
  const headerStore = await headers();
  const token = bearerTokenFrom(headerStore.get("authorization"));
  if (token) {
    const bearerClient = createBearerClient(token);
    const {
      data: { user: bearerUser },
    } = await bearerClient.auth.getUser(token);
    if (!bearerUser) {
      return { supabase: null, user: null, error: notAuthenticated() };
    }
    return { supabase: bearerClient, user: bearerUser, error: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase: null, user: null, error: notAuthenticated() };
  }

  // Admin impersonation: if the real user is an admin and the impersonation
  // cookie is set, substitute the target user's ID throughout the request so
  // all existing data queries (which filter by user.id) automatically read/write
  // for the target user. The admin-override RLS policies allow this.
  const cookieStore = await cookies();
  const impersonateId = cookieStore.get(IMPERSONATE_COOKIE)?.value;
  if (impersonateId && impersonateId !== user.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.is_admin) {
      return { supabase, user: { ...user, id: impersonateId } as User, error: null };
    }
  }

  return { supabase, user, error: null };
}

/**
 * An error whose message is safe to show the caller.
 *
 * Throw this when the text is something the user can act on ("That file has no
 * recognisable columns"). Anything else reaching errorResponse is treated as
 * internal.
 */
export class PublicError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PublicError";
    this.status = status;
  }
}

/**
 * Turn a thrown value into a response.
 *
 * Server faults never echo `err.message` back: these handlers sit on top of
 * Postgres, and its errors name columns, constraints and relations. That is a
 * free schema read for anyone who can reach the route. The detail goes to the
 * server log instead, which is also the only place most of these failures were
 * ever recorded.
 */
export function errorResponse(err: unknown, status = 500): NextResponse {
  if (err instanceof PublicError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Deliberate 4xx from a caller that passed its own status: the message is the
  // handler's own text, not a leaked internal one.
  if (status < 500) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status });
  }
  console.error("[api] unhandled error:", err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status });
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
