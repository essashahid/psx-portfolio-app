import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Server-only. Used for cross-cutting jobs (e.g. stock_master
 * enrichment) — never for reading user data on behalf of a request; user-scoped
 * queries always go through the RLS-enforced server client.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
