"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Upload,
  Briefcase,
  Newspaper,
  Sparkles,
  Target,
  NotebookPen,
  Bell,
  Settings,
  LogOut,
  CandlestickChart,
  HandCoins,
  Search,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/import", label: "Import Center", icon: Upload },
  { href: "/holdings", label: "Holdings", icon: Briefcase },
  { href: "/stocks", label: "Stock Research", icon: Search },
  { href: "/news", label: "News Center", icon: Newspaper },
  { href: "/briefings", label: "AI Briefings", icon: Sparkles },
  { href: "/goals", label: "Goals & Targets", icon: Target },
  { href: "/dividends", label: "Dividends", icon: HandCoins },
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ email, openAlerts }: { email: string; openAlerts: number }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <CandlestickChart className="h-6 w-6 text-emerald-600" />
        <div>
          <p className="text-sm font-semibold leading-tight tracking-tight">PortfolioOS PK</p>
          <p className="eyebrow mt-0.5 text-[9px]">PSX command center</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-sidebar-active text-white shadow-sm"
                  : "text-sidebar-muted hover:bg-accent hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {item.href === "/alerts" && openAlerts > 0 && (
                <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                  {openAlerts}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-4 py-3">
        <p className="truncate text-[11px] text-sidebar-muted">{email}</p>
        <button
          onClick={signOut}
          className="mt-1.5 flex items-center gap-1.5 text-[12px] text-sidebar-muted transition-colors hover:text-sidebar-foreground"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </aside>
  );
}
