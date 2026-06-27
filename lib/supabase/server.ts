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

const IMPERSONATE_COOKIE = "x_admin_impersonate";

/**
 * The real signed-in user from the JWT. Never substituted by impersonation.
 * Use this where you need the actual account (admin guards, billing, sign-out).
 * All other server components should call getUser() which honours impersonation.
 */
export const getRealUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (claims?.sub) {
    return { id: claims.sub, email: (claims.email as string) ?? "" };
  }
  // Fallback for symmetric-key projects where local JWT verification is unavailable.
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
 * Resolves admin impersonation. Returns the customer being viewed as `user`
 * and the real signed-in admin as `realUser`. When not impersonating, both
 * are identical. The layout uses this to show the impersonation banner;
 * getUser() delegates here so pages get the right user automatically.
 */
export const getEffectiveUser = cache(async (): Promise<EffectiveUser | null> => {
  const realUser = await getRealUser();
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

  return {
    user: { id: impersonateId, email: data.user.email ?? "" },
    realUser,
    isImpersonating: true,
  };
});

/**
 * The effective user for the current request. During admin impersonation this
 * returns the customer being viewed, so all 19 server-component pages
 * automatically render that customer's data without any individual changes.
 * When not impersonating, returns the real signed-in user.
 */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const effective = await getEffectiveUser();
  return effective?.user ?? null;
});
