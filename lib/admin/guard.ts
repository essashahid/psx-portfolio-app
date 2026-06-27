import { NextResponse } from "next/server";
import { cache } from "react";
import { createClient, getRealUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Admin gate for API routes. Verifies a real session (auth.getUser), then
 * confirms profiles.is_admin. Returns the request-scoped (RLS) client, the
 * user, and a service-role `admin` client for Auth admin operations
 * (createUser / deleteUser / updateUserById). Non-admins get a 403; the
 * service-role client is never handed to them.
 */
export async function requireAdmin(): Promise<
  | { supabase: SupabaseClient; admin: SupabaseClient; user: User; error: null }
  | { supabase: null; admin: null; user: null; error: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      supabase: null,
      admin: null,
      user: null,
      error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }),
    };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return {
      supabase: null,
      admin: null,
      user: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { supabase, admin: createAdminClient(), user, error: null };
}

/**
 * Admin gate for server components / layouts. Returns the user and whether they
 * are an admin; the admin layout uses this to redirect non-admins. Cached per
 * request so the layout and page share one lookup.
 */
export const getAdminContext = cache(
  async (): Promise<{ user: { id: string; email: string } | null; isAdmin: boolean }> => {
    // Use getRealUser so admin panel access is always gated on the actual
    // signed-in account, not the impersonated user.
    const user = await getRealUser();
    if (!user) return { user: null, isAdmin: false };
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    return { user, isAdmin: Boolean(data?.is_admin) };
  }
);
