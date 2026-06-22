import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { MobileBottomNav, MobileTopBar, Sidebar } from "@/components/sidebar";
import { AutoRefreshPrices } from "@/components/auto-refresh-prices";
import { NavProgress } from "@/components/nav-progress";
import { DISCLAIMER } from "@/lib/utils";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "open");

  return (
    <div className="min-h-dvh bg-background md:flex md:h-dvh md:overflow-hidden">
      <NavProgress />
      <AutoRefreshPrices />
      <Sidebar email={user.email ?? ""} openAlerts={count ?? 0} />
      <div className="flex min-w-0 flex-1 flex-col md:h-dvh">
        <MobileTopBar openAlerts={count ?? 0} />
        <main className="scroll-touch flex-1 overflow-y-auto overscroll-y-contain px-3 py-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4 md:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
        <footer className="hidden border-t border-border bg-card px-6 py-2 md:block">
          <p className="mx-auto max-w-7xl text-[11px] text-muted-foreground">{DISCLAIMER}</p>
        </footer>
      </div>
      <MobileBottomNav email={user.email ?? ""} openAlerts={count ?? 0} />
    </div>
  );
}
