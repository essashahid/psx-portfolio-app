import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { DISCLAIMER } from "@/lib/utils";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "open");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar email={user.email ?? ""} openAlerts={count ?? 0} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
        <footer className="border-t border-border bg-card px-6 py-2">
          <p className="text-[11px] text-muted-foreground">{DISCLAIMER}</p>
        </footer>
      </div>
    </div>
  );
}
