import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
