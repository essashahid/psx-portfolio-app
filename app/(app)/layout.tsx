import { redirect } from "next/navigation";
import { createClient, getEffectiveUser } from "@/lib/supabase/server";
import { MobileBottomNav, MobileTopBar, Sidebar } from "@/components/sidebar";
import { AutoRefreshPrices } from "@/components/auto-refresh-prices";
import { NavProgress } from "@/components/nav-progress";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { FeedbackWidget } from "@/components/feedback-widget";
import { DISCLAIMER } from "@/lib/utils";
import { resolveVisibleHrefs } from "@/lib/nav";
import type { ExperienceLevel } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const effective = await getEffectiveUser();
  if (!effective) redirect("/login");

  const { user, realUser, isImpersonating } = effective;

  // When impersonating, the admin's client has override RLS so it can read the
  // impersonated user's profile. We load alerts and profile for the effective
  // user (the customer), so the admin sees exactly what the customer sees.
  const [{ count }, profileRes] = await Promise.all([
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "open"),
    supabase
      .from("profiles")
      .select("onboarded, experience_level, extra_features, hidden_features, enabled_features, is_admin, demo_mode")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // Skip the onboarding redirect when an admin is viewing on behalf of a user
  // who hasn't finished onboarding — the admin can see their data regardless.
  if (!profileRes.data?.onboarded && !isImpersonating) redirect("/onboarding");

  // is_admin is based on the REAL user, not the impersonated one, so the Admin
  // nav link stays visible while impersonating.
  const isAdmin = isImpersonating
    ? true
    : Boolean(profileRes.data?.is_admin);
  const isDemo = Boolean(profileRes.data?.demo_mode);

  const visibleHrefs = resolveVisibleHrefs(
    {
      experience_level: (profileRes.data?.experience_level as ExperienceLevel) ?? "intermediate",
      extra_features: profileRes.data?.extra_features ?? [],
      hidden_features: profileRes.data?.hidden_features ?? [],
      enabled_features: profileRes.data?.enabled_features ?? [],
    },
    isAdmin
  );

  return (
    <div className="min-h-dvh bg-background md:flex md:h-dvh md:overflow-hidden">
      <NavProgress />
      <AutoRefreshPrices />
      <Sidebar email={user.email ?? ""} openAlerts={count ?? 0} visibleHrefs={visibleHrefs} isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col md:h-dvh">
        <MobileTopBar openAlerts={count ?? 0} />
        {isImpersonating && (
          <ImpersonationBanner
            viewingEmail={user.email}
            adminEmail={realUser.email}
          />
        )}
        {isDemo && (
          <div className="shrink-0 border-b border-blue-200 bg-blue-50 px-3 py-2 text-center text-xs text-blue-900 sm:px-4">
            Read-only demo: explore the launch tabs and curated Copilot research. Editing, refreshes and AI generation are disabled.
          </div>
        )}
        <main className="scroll-touch flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4 md:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
        <footer className="hidden border-t border-border bg-card px-6 py-2 md:block">
          <p className="mx-auto max-w-7xl text-[11px] text-muted-foreground">{DISCLAIMER}</p>
        </footer>
      </div>
      {user.email === "demo@example.com" && <FeedbackWidget isDemo={isDemo} />}
      <MobileBottomNav email={user.email ?? ""} openAlerts={count ?? 0} visibleHrefs={visibleHrefs} isAdmin={isAdmin} />
    </div>
  );
}
