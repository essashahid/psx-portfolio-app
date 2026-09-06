import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase sends an invited (or password-reset) user back to.
 *
 * Two link shapes are handled: the PKCE `?code=` exchange used when the
 * invite was sent with a redirectTo on this origin, and the `?token_hash=`
 * plus `type` form the default email templates produce. Either way a session
 * is established and the user continues to `next`, which for an invite is
 * the set-password page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/auth/set-password";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const supabase = await createClient();

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  let failed: string | null = null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) failed = error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "invite" | "recovery" | "email" | "magiclink" | "signup" });
    if (error) failed = error.message;
  } else {
    failed = "missing code";
  }

  if (failed) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("invite", "expired");
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
