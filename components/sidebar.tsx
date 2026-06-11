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
  Database,
  Activity,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/import", label: "Import Center", icon: Upload },
  { href: "/holdings", label: "Holdings", icon: Briefcase },
  { href: "/stocks", label: "Stock Research", icon: Search },
  { href: "/market", label: "Market Pulse", icon: Activity },
  { href: "/news", label: "News Center", icon: Newspaper },
  { href: "/briefings", label: "AI Briefings", icon: Sparkles },
  { href: "/goals", label: "Goals & Targets", icon: Target },
  { href: "/dividends", label: "Dividends", icon: HandCoins },
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/coverage", label: "Data Engine", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];

function activeNavItem(pathname: string) {
  return NAV.find((item) => pathname === item.href || pathname.startsWith(item.href + "/")) ?? NAV[0];
}

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
    <aside className="hidden h-dvh w-56 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex">
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

export function MobileTopBar({ email, openAlerts }: { email: string; openAlerts: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeNavItem(pathname);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur md:hidden">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CandlestickChart className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">PortfolioOS PK</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {active.label}
            {openAlerts > 0 ? ` · ${openAlerts} alert${openAlerts === 1 ? "" : "s"}` : ""}
          </span>
        </span>
      </Link>
      <button
        onClick={signOut}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted"
        aria-label={`Sign out ${email}`}
        title="Sign out"
      >
        <LogOut className="h-[18px] w-[18px]" />
      </button>
    </header>
  );
}

export function MobileBottomNav({ openAlerts }: { openAlerts: number }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-[0_-12px_36px_-28px_rgba(0,0,0,0.55)] backdrop-blur md:hidden">
      <div className="scroll-touch flex gap-1 overflow-x-auto px-2 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] pt-1.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-12 min-w-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[10px] font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground active:bg-muted active:text-foreground"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="max-w-full truncate leading-none">{item.label}</span>
              {item.href === "/alerts" && openAlerts > 0 && (
                <span
                  className={cn(
                    "absolute right-1.5 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                    active ? "bg-white text-primary" : "bg-amber-500 text-black"
                  )}
                >
                  {openAlerts}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
