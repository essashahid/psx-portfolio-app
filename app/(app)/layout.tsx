import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { MobileBottomNav, MobileTopBar, Sidebar } from "@/components/sidebar";
import { AutoRefreshPrices } from "@/components/auto-refresh-prices";
import { NavProgress } from "@/components/nav-progress";
import { DISCLAIMER } from "@/lib/utils";
import { resolveVisibleHrefs } from "@/lib/nav";
import type { ExperienceLevel } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) redirect("/login");

  const [{ count }, profileRes] = await Promise.all([
    supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "open"),
    supabase
      .from("profiles")
      .select("onboarded, experience_level, extra_features, hidden_features, is_admin")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // First-time users finish onboarding before seeing the app. A missing profile
  // row is treated as not-onboarded so the wizard always runs once.
  if (!profileRes.data?.onboarded) redirect("/onboarding");

  const isAdmin = Boolean(profileRes.data?.is_admin);

  const visibleHrefs = resolveVisibleHrefs({
    experience_level: (profileRes.data.experience_level as ExperienceLevel) ?? "intermediate",
    extra_features: profileRes.data.extra_features ?? [],
    hidden_features: profileRes.data.hidden_features ?? [],
  });

  return (
    <div className="min-h-dvh bg-background md:flex md:h-dvh md:overflow-hidden">
      <NavProgress />
      <AutoRefreshPrices />
      <Sidebar email={user.email ?? ""} openAlerts={count ?? 0} visibleHrefs={visibleHrefs} isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col md:h-dvh">
        <MobileTopBar openAlerts={count ?? 0} />
        <main className="scroll-touch flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4 md:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
        <footer className="hidden border-t border-border bg-card px-6 py-2 md:block">
          <p className="mx-auto max-w-7xl text-[11px] text-muted-foreground">{DISCLAIMER}</p>
        </footer>
      </div>
      <MobileBottomNav email={user.email ?? ""} openAlerts={count ?? 0} visibleHrefs={visibleHrefs} isAdmin={isAdmin} />
    </div>
  );
}
