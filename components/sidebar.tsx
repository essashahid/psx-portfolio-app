"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link, { useLinkStatus } from "next/link";
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
  BarChart3,
  HandCoins,
  Search,
  Database,
  Activity,
  Menu,
  X,
  Loader2,
  FileText,
} from "lucide-react";

/**
 * Navigation grouped into labelled sections so the 15 destinations read as a
 * structured map, not a flat wall — a newcomer can see "where do I look at my
 * money / research an idea / plan / manage data". `NAV` stays a flat derived
 * list for active-route matching and the mobile bottom bar.
 */
type NavItemDef = { href: string; label: string; icon: ComponentType<{ className?: string }>; hint: string };

const NAV_SECTIONS: { title: string; items: NavItemDef[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Your portfolio at a glance" },
      { href: "/holdings", label: "Holdings", icon: Briefcase, hint: "Positions, P/L and weights" },
      { href: "/dividends", label: "Dividends", icon: HandCoins, hint: "Payouts received and forecast" },
    ],
  },
  {
    title: "Research",
    items: [
      { href: "/stocks", label: "Stock Research", icon: Search, hint: "Fundamentals, ratios and structure per stock" },
      { href: "/market", label: "Market Pulse", icon: Activity, hint: "Index, breadth, sectors and flows" },
      { href: "/bulls-bears", label: "Bulls & Bears", icon: BarChart3, hint: "Weekly regime, picks and watchlist" },
      { href: "/news", label: "News Center", icon: Newspaper, hint: "Portfolio and market news" },
      { href: "/chat", label: "Research Copilot", icon: Sparkles, hint: "Ask anything about your portfolio and PSX" },
      { href: "/briefings", label: "AI Briefings", icon: FileText, hint: "Generated portfolio and market briefs" },
    ],
  },
  {
    title: "Planning",
    items: [
      { href: "/goals", label: "Goals & Targets", icon: Target, hint: "Targets and progress" },
      { href: "/journal", label: "Journal", icon: NotebookPen, hint: "Your decisions and notes" },
      { href: "/alerts", label: "Alerts", icon: Bell, hint: "Triggered watch conditions" },
    ],
  },
  {
    title: "Data & setup",
    items: [
      { href: "/import", label: "Import Center", icon: Upload, hint: "Import statements and transactions" },
      { href: "/coverage", label: "Data Engine", icon: Database, hint: "Data coverage and provider health" },
      { href: "/settings", label: "Settings", icon: Settings, hint: "Preferences and account" },
    ],
  },
];

const NAV = NAV_SECTIONS.flatMap((s) => s.items);

const MOBILE_NAV = NAV.filter((item) =>
  ["/dashboard", "/holdings", "/market", "/chat"].includes(item.href)
);

const MOBILE_MORE_SECTIONS = NAV_SECTIONS.map((section) => ({
  ...section,
  items: section.items.filter((item) => !MOBILE_NAV.some((primary) => primary.href === item.href)),
})).filter((section) => section.items.length > 0);

function activeNavItem(pathname: string) {
  return NAV.find((item) => pathname === item.href || pathname.startsWith(item.href + "/")) ?? NAV[0];
}

type NavIcon = ComponentType<{ className?: string }>;

/**
 * Desktop sidebar row. `useLinkStatus` lets us highlight the row and swap the
 * icon for a spinner the instant it is clicked — before the server-rendered
 * page is ready — so navigation never feels unresponsive.
 */
function SidebarRow({
  icon: Icon,
  label,
  active,
  badge,
}: {
  icon: NavIcon;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const { pending } = useLinkStatus();
  const lit = active || pending;
  return (
    <span
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
        lit
          ? "bg-sidebar-active text-white shadow-sm"
          : "text-sidebar-muted hover:bg-accent hover:text-sidebar-foreground"
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
      {badge ? (
        <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-black">
          {badge}
        </span>
      ) : null}
    </span>
  );
}

function MobileMenuRow({
  icon: Icon,
  label,
  active,
  badge,
}: {
  icon: NavIcon;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const { pending } = useLinkStatus();
  const lit = active || pending;
  return (
    <span
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        lit ? "bg-muted text-foreground" : "text-muted-foreground active:bg-muted active:text-foreground"
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Icon className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", lit ? "bg-white text-primary" : "bg-amber-500 text-black")}>
          {badge}
        </span>
      ) : null}
    </span>
  );
}

function BottomNavRow({
  icon: Icon,
  label,
  active,
  badge,
}: {
  icon: NavIcon;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const { pending } = useLinkStatus();
  const lit = active || pending;
  return (
    <span
      className={cn(
        "relative flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-medium transition-colors",
        lit ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-muted active:text-foreground"
      )}
    >
      {pending ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin" /> : <Icon className="h-[18px] w-[18px] shrink-0" />}
      <span className="max-w-full truncate leading-none">{label}</span>
      {badge ? (
        <span
          className={cn(
            "absolute right-0.5 top-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
            "bg-amber-500 text-black"
          )}
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
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
      <nav className="flex-1 space-y-3 overflow-y-auto px-2 pb-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="space-y-0.5">
            <p className="eyebrow px-3 pb-0.5 text-[9px]">{section.title}</p>
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link key={item.href} href={item.href} className="block" title={item.hint}>
                  <SidebarRow
                    icon={item.icon}
                    label={item.label}
                    active={active}
                    badge={item.href === "/alerts" && openAlerts > 0 ? openAlerts : undefined}
                  />
                </Link>
              );
            })}
          </div>
        ))}
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

export function MobileTopBar({ openAlerts }: { openAlerts: number }) {
  const pathname = usePathname();
  const active = activeNavItem(pathname);

  return (
    <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-border bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" aria-label="PortfolioOS home">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CandlestickChart className="h-4 w-4" />
        </span>
        <span className="truncate text-base font-semibold">{active.label}</span>
      </Link>
      <Link
        href="/alerts"
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
        aria-label={openAlerts > 0 ? `${openAlerts} open alerts` : "Alerts"}
      >
        <Bell className="h-5 w-5" />
        {openAlerts > 0 && (
          <span className="absolute right-1 top-1 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[9px] font-semibold leading-4 text-black">
            {openAlerts > 99 ? "99+" : openAlerts}
          </span>
        )}
      </Link>
    </header>
  );
}

export function MobileBottomNav({ email, openAlerts }: { email: string; openAlerts: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryPath = MOBILE_NAV.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"));

  useEffect(() => {
    if (!moreOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-[0_-12px_36px_-28px_rgba(0,0,0,0.55)] backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1 px-2 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] pt-1.5">
          {MOBILE_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const shortLabel = item.href === "/dashboard" ? "Home" : item.href === "/chat" ? "Copilot" : item.label.replace(" Pulse", "");
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="block">
                <BottomNavRow icon={item.icon} label={shortLabel} active={active} />
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} className="block min-w-0">
            <BottomNavRow icon={Menu} label="More" active={!primaryPath || moreOpen} badge={openAlerts > 0 ? openAlerts : undefined} />
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More navigation">
          <button className="absolute inset-0 bg-black/35" onClick={() => setMoreOpen(false)} aria-label="Close menu" />
          <div className="scroll-touch absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-card pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="text-base font-semibold">More</p>
                <p className="truncate text-[11px] text-muted-foreground">{email}</p>
              </div>
              <button onClick={() => setMoreOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground active:bg-muted" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="grid gap-4 p-3">
              {MOBILE_MORE_SECTIONS.map((section) => (
                <div key={section.title} className="grid gap-1">
                  <p className="eyebrow px-3 text-[9px]">{section.title}</p>
                  {section.items.map((item) => {
                    const activeItem = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} className="block">
                        <MobileMenuRow icon={item.icon} label={item.label} active={activeItem} badge={item.href === "/alerts" && openAlerts > 0 ? openAlerts : undefined} />
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="border-t border-border px-3 pt-3">
              <button onClick={signOut} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground active:bg-muted">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
