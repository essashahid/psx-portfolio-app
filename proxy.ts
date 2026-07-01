import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { featureAllowed, featureForPath } from "@/lib/features";

const IMPERSONATE_COOKIE = "x_admin_impersonate";

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Verify the JWT locally instead of calling the Auth server on every request.
  // getClaims() also refreshes the session cookie when needed (via setAll above),
  // so the network round-trip of getUser() is only paid as a fallback for
  // symmetric-key projects where local verification is unavailable.
  let user: { id: string } | null = null;
  const { data: claimsData } = await supabase.auth.getClaims();
  const sub = claimsData?.claims?.sub;
  if (sub) {
    user = { id: sub as string };
  } else {
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser ? { id: fetchedUser.id } : null;
  }

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" || path.startsWith("/auth") || path === "/favicon.ico" || path === "/manifest.webmanifest" || path.startsWith("/sw.js") || path.startsWith("/workbox-");

  if (!user && !isPublic && !path.startsWith("/api")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (user && !path.startsWith("/api")) {
    const gatedFeature = featureForPath(path);
    if (gatedFeature) {
      const { data: realProfile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();
      const realIsAdmin = Boolean(realProfile?.is_admin);
      const impersonateId = request.cookies.get(IMPERSONATE_COOKIE)?.value;
      const effectiveId = realIsAdmin && impersonateId ? impersonateId : user.id;
      const { data: effectiveProfile } = await supabase
        .from("profiles")
        .select("enabled_features")
        .eq("id", effectiveId)
        .maybeSingle();

      if (!featureAllowed(gatedFeature, effectiveProfile?.enabled_features, realIsAdmin)) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|workbox-.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
