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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" || path.startsWith("/auth") || path === "/favicon.ico";

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
