import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// cache() dedupes per request: layout + page share one client instance.
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — session refresh is handled by proxy.
          }
        },
      },
    }
  );
});

export interface SessionUser {
  id: string;
  email: string;
}

/**
 * Fast per-request user lookup for server components.
 *
 * The proxy middleware already validates and refreshes the session on every
 * request, so pages don't need another auth-server round-trip: getClaims()
 * verifies the JWT locally (asymmetric keys, cached JWKS) and cache() dedupes
 * across layout + page. RLS still enforces ownership on every DB query.
 * API routes keep using requireUser()/auth.getUser() for full validation.
 */
const IMPERSONATE_COOKIE = "x_admin_impersonate";

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (claims?.sub) {
    return { id: claims.sub, email: (claims.email as string) ?? "" };
  }
  // Fallback (e.g. symmetric-key projects where local verification is unavailable)
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? "" } : null;
});

export type EffectiveUser = {
  user: SessionUser;
  realUser: SessionUser;
  isImpersonating: boolean;
};

/**
 * Like getUser() but resolves admin impersonation. Server components that need
 * to render data as a specific customer (e.g. the app layout) use this instead
 * of getUser(). The real user's identity is preserved in `realUser` so the
 * impersonation banner can show who is actually signed in.
 */
export const getEffectiveUser = cache(async (): Promise<EffectiveUser | null> => {
  const realUser = await getUser();
  if (!realUser) return null;

  const cookieStore = await cookies();
  const impersonateId = cookieStore.get(IMPERSONATE_COOKIE)?.value;
  if (!impersonateId || impersonateId === realUser.id) {
    return { user: realUser, realUser, isImpersonating: false };
  }

  // Verify the real user is still an admin before honouring the cookie.
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", realUser.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return { user: realUser, realUser, isImpersonating: false };
  }

  // Resolve the impersonated user's email from the Auth admin API.
  const adminClient = createAdminClient();
  const { data } = await adminClient.auth.admin.getUserById(impersonateId);
  if (!data?.user) {
    return { user: realUser, realUser, isImpersonating: false };
  }

  const impersonatedUser: SessionUser = {
    id: impersonateId,
    email: data.user.email ?? "",
  };
  return { user: impersonatedUser, realUser, isImpersonating: true };
});
