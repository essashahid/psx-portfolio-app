import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client authenticated by a user's access token rather than by
 * session cookies.
 *
 * The mobile app has no cookie jar: it holds a Supabase session in device
 * storage and sends the access token as a bearer header. Passing that token
 * through as the Authorization header means PostgREST still evaluates every
 * query as that user, so RLS is unchanged. This uses the anon key, never the
 * service role, precisely so that stays true.
 *
 * Deliberately not wrapped in React cache(): the client is keyed by a token,
 * and caching one across requests would hand one caller another's session.
 */
export function createBearerClient(accessToken: string): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      // Nothing to persist or refresh on the server; the device owns the session.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
}

/**
 * The bearer token on the current request, or null.
 *
 * Returns null for anything that is not a well formed `Bearer <token>` so the
 * caller falls through to cookie auth rather than failing outright.
 */
export function bearerTokenFrom(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}
