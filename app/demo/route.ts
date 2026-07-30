import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { startDemoSession } from "@/lib/demo/session";

export const maxDuration = 120;

/** Only same-origin app paths, so the link can never bounce somewhere else. */
function safePath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

/**
 * One-click entry to the shared read-only demo: GET /demo signs the visitor
 * into the demo workspace and lands them on the page they asked for. It exists
 * so a link can be handed to someone (or something) that cannot click the
 * "Try the read-only demo" button, such as a screen-recording bot or a
 * reviewer's agent. Same exposure as that button, which is already public.
 */
export async function GET(request: NextRequest) {
  const target = safePath(request.nextUrl.searchParams.get("to"));
  const response = NextResponse.redirect(new URL(target, request.nextUrl.origin));

  // Cookie writes must land on the redirect response itself, otherwise the
  // browser follows the redirect with no session attached.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  try {
    const result = await startDemoSession(supabase);
    if (!result.ok) {
      return NextResponse.redirect(new URL("/login?demo=unavailable", request.nextUrl.origin));
    }
  } catch {
    return NextResponse.redirect(new URL("/login?demo=unavailable", request.nextUrl.origin));
  }

  return response;
}
