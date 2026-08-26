"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/shared/format";
import {
  LogOut,
  Menu,
  X,
  Loader2,
  Bell,
  Search,
  ShieldCheck,
  ChevronDown,
  Settings,
} from "lucide-react";
import { NAV, NAV_SECTIONS } from "@/lib/config/navigation";
import { PlumbMark } from "@/components/shared/plumb-mark";

/** The design's 4 inline primary tabs. Everything else lives in "Research ∨". */
const PRIMARY_HREFS = ["/dashboard", "/holdings", "/dividends", "/performance"];

/**
 * Destinations the desktop header already owns: the bell goes to alerts, the
 * account menu goes to settings. Listing them in the Research dropdown as well
 * would be a third route to two pages. The mobile "More" sheet still carries
 * them, because it has no bell-and-avatar row of its own.
 */
const CHROME_HREFS = ["/alerts", "/settings"];

function primaryTabs(visibleHrefs: string[]) {
  const allowed = new Set(visibleHrefs);
  return NAV.filter((item) => PRIMARY_HREFS.includes(item.href) && allowed.has(item.href)).sort(
    (a, b) => PRIMARY_HREFS.indexOf(a.href) - PRIMARY_HREFS.indexOf(b.href)
  );
}

function visibleSections(visibleHrefs: string[], excludeHrefs: string[] = []) {
  const allowed = new Set(visibleHrefs);
  const excluded = new Set(excludeHrefs);
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => allowed.has(item.href) && !excluded.has(item.href)),
  })).filter((section) => section.items.length > 0);
}

function mobilePrimary(visibleHrefs: string[]) {
  const allowed = new Set(visibleHrefs);
  const wanted = ["/dashboard", "/holdings", "/market", "/dividends", "/chat"];
  const picked = wanted.filter((href) => allowed.has(href)).slice(0, 4);
  return NAV.filter((item) => picked.includes(item.href)).sort(
    (a, b) => picked.indexOf(a.href) - picked.indexOf(b.href)
  );
}

function activeNavItem(pathname: string) {
  return NAV.find((item) => pathname === item.href || pathname.startsWith(item.href + "/")) ?? NAV[0];
}

function openCommandPalette() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
}

async function signOutAndRedirect(router: ReturnType<typeof useRouter>) {
  const supabase = createClient();
  await supabase.auth.signOut();
  router.push("/login");
  router.refresh();
}

/**
 * Desktop shell: logo, inline primary tabs, a "Research ∨" overflow menu for
 * everything else, then search / alerts / account on the right. Replaces the
 * former left sidebar — hidden below md, where MobileTopBar + MobileBottomNav
 * take over.
 */
export function TopNav({
  email,
  openAlerts,
  visibleHrefs,
  isAdmin = false,
}: {
  email: string;
  openAlerts: number;
  visibleHrefs: string[];
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const tabs = primaryTabs(visibleHrefs);
  const overflowSections = visibleSections(visibleHrefs, [...PRIMARY_HREFS, ...CHROME_HREFS]);
  const activeOverflow = overflowSections
    .flatMap((s) => s.items)
    .find((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
  const menuActive = overflowSections.some((section) =>
    section.items.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))
  ) || (isAdmin && (pathname === "/admin" || pathname.startsWith("/admin/")));

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 hidden border-b border-rule bg-surface-page/94 backdrop-blur-(--blur-bar) md:block">
      <div className="flex items-center gap-8 px-(--gutter-page) py-3.5">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label="PortfolioOS home">
          <PlumbMark size={19} className="block shrink-0 text-text-strong" />
          <span className="font-display text-[15px] tracking-editorial text-text-strong">Plumb</span>
        </Link>

        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2">
          {tabs.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                className={cn(
                  "whitespace-nowrap text-sm transition-colors",
                  active ? "font-semibold text-text-strong" : "font-medium text-text-muted hover:text-text-strong"
                )}
              >
                {item.label}
              </Link>
            );
          })}

          {overflowSections.length > 0 || isAdmin ? (
            <div ref={menuRef} className="relative inline-flex">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap text-sm transition-colors",
                  menuActive || menuOpen ? "font-semibold text-text-strong" : "font-medium text-text-muted hover:text-text-strong"
                )}
              >
                {activeOverflow?.label ?? "Research"}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", menuOpen && "rotate-180")} />
              </button>
              {menuOpen && (
                <div className="absolute left-0 top-full z-40 mt-3 grid w-64 gap-4 rounded-lg border border-rule bg-surface-raised p-4 shadow-(--shadow-dialog)">
                  {overflowSections.map((section) => (
                    <div key={section.title} className="grid gap-0.5">
                      <p className="eyebrow px-1 pb-1 text-[9px]">{section.title}</p>
                      {section.items.map((item) => {
                        const active = pathname === item.href || pathname.startsWith(item.href + "/");
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMenuOpen(false)}
                            title={item.hint}
                            className={cn(
                              "flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] transition-colors",
                              active ? "bg-surface-sunken font-semibold text-text-strong" : "font-medium text-text-muted hover:bg-surface-sunken hover:text-text-strong"
                            )}
                          >
                            <item.icon className="h-3.5 w-3.5 shrink-0" />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                  {isAdmin && (
                    <div className="grid gap-0.5 border-t border-rule pt-3">
                      <p className="eyebrow px-1 pb-1 text-[9px]">Administration</p>
                      <Link
                        href="/admin"
                        onClick={() => setMenuOpen(false)}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] font-medium transition-colors",
                          pathname === "/admin" || pathname.startsWith("/admin/")
                            ? "bg-brand-soft font-semibold text-brand"
                            : "text-text-muted hover:bg-surface-sunken hover:text-text-strong"
                        )}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Admin
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </nav>

        <div className="flex shrink-0 items-center gap-4 text-text-faint">
          <button
            type="button"
            onClick={openCommandPalette}
            title="Search tickers, pages and actions"
            aria-label="Search"
            className="inline-flex items-center text-inherit transition-colors hover:text-text-strong"
          >
            <Search className="h-[15px] w-[15px]" />
          </button>
          <Link
            href="/alerts"
            title="Alerts"
            aria-label={openAlerts > 0 ? `${openAlerts} open alerts` : "Alerts"}
            className="relative inline-flex items-center text-inherit transition-colors hover:text-text-strong"
          >
            <Bell className="h-[15px] w-[15px]" />
            {openAlerts > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-[14px] rounded-full bg-saffron px-1 text-center text-[9px] font-semibold leading-[14px] text-white">
                {openAlerts > 9 ? "9+" : openAlerts}
              </span>
            )}
          </Link>
          <AccountMenu email={email} onSignOut={() => void signOutAndRedirect(router)} />
        </div>
      </div>
    </header>
  );
}

/**
 * The account avatar and its menu.
 *
 * The avatar used to sign you out on a single click, with no menu and no
 * confirmation — the one control in the header whose obvious reading (open my
 * account) and actual behaviour (end my session) were opposites. It opens a
 * menu now, and signing out is a deliberate second click.
 */
function AccountMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        className="flex h-[1.625rem] w-[1.625rem] items-center justify-center rounded-full bg-ink-1 text-[10px] font-semibold tracking-[0.02em] text-white transition-opacity hover:opacity-85"
      >
        {(email || "?").slice(0, 2).toUpperCase()}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.625rem)] z-40 min-w-[13.75rem] border border-rule bg-surface-raised py-1.5 shadow-(--shadow-raised)"
        >
          <p className="truncate px-3.5 pb-2 pt-1 text-(length:--text-2xs) text-text-faint" title={email}>
            {email}
          </p>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-text-body transition-colors hover:bg-surface-sunken hover:text-text-strong"
          >
            <Settings className="h-[15px] w-[15px]" />
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="flex w-full items-center gap-2.5 border-t border-rule px-3.5 py-2 text-left text-sm text-text-body transition-colors hover:bg-surface-sunken hover:text-text-strong"
          >
            <LogOut className="h-[15px] w-[15px]" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

type NavIcon = ComponentType<{ className?: string }>;

function MobileMenuRow({ icon: Icon, label, active, badge }: { icon: NavIcon; label: string; active: boolean; badge?: number }) {
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
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", lit ? "bg-white text-primary" : "bg-saffron text-white")}>
          {badge}
        </span>
      ) : null}
    </span>
  );
}

function BottomNavRow({ icon: Icon, label, active, badge }: { icon: NavIcon; label: string; active: boolean; badge?: number }) {
  const { pending } = useLinkStatus();
  const lit = active || pending;
  return (
    <span
      className={cn(
        "relative flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-medium transition-colors",
        lit ? "bg-brand text-white" : "text-muted-foreground active:bg-muted active:text-foreground"
      )}
    >
      {pending ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin" /> : <Icon className="h-[18px] w-[18px] shrink-0" />}
      <span className="max-w-full truncate leading-none">{label}</span>
      {badge ? (
        <span className="absolute right-0.5 top-0.5 rounded-full bg-saffron px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white">
          {badge}
        </span>
      ) : null}
    </span>
  );
}

export function MobileTopBar({ openAlerts }: { openAlerts: number }) {
  const pathname = usePathname();
  const active = activeNavItem(pathname);

  return (
    <header className="sticky top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-rule bg-surface-page/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" aria-label="PortfolioOS home">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-1 text-white">
          <PlumbMark size={14} tone="mono" />
        </span>
        <span className="truncate text-base font-semibold text-text-strong">{active.label}</span>
      </Link>
      <Link
        href="/alerts"
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-muted active:bg-muted"
        aria-label={openAlerts > 0 ? `${openAlerts} open alerts` : "Alerts"}
      >
        <Bell className="h-5 w-5" />
        {openAlerts > 0 && (
          <span className="absolute right-1 top-1 min-w-4 rounded-full bg-saffron px-1 text-center text-[9px] font-semibold leading-4 text-white">
            {openAlerts > 99 ? "99+" : openAlerts}
          </span>
        )}
      </Link>
    </header>
  );
}

export function MobileBottomNav({
  email,
  openAlerts,
  visibleHrefs,
  isAdmin = false,
}: {
  email: string;
  openAlerts: number;
  visibleHrefs: string[];
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const mobileNav = mobilePrimary(visibleHrefs);
  const moreSections = visibleSections(visibleHrefs, mobileNav.map((item) => item.href));
  const primaryPath = mobileNav.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"));

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

  return (
    <>
      <nav aria-label="Primary navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-surface-raised/95 shadow-(--shadow-nav) backdrop-blur md:hidden">
        <div
          className="grid gap-1 px-2 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] pt-1.5"
          style={{ gridTemplateColumns: `repeat(${mobileNav.length + 1}, minmax(0, 1fr))` }}
        >
          {mobileNav.map((item) => {
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
          <div className="scroll-touch absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-rule bg-surface-raised pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-(--shadow-dialog)">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule bg-surface-raised px-4 py-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-text-strong">More</p>
                <p className="truncate text-[11px] text-text-muted">{email}</p>
              </div>
              <button onClick={() => setMoreOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-text-muted active:bg-muted" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="grid gap-4 p-3">
              {moreSections.map((section) => (
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
              {isAdmin && (
                <div className="grid gap-1">
                  <p className="eyebrow px-3 text-[9px]">Administration</p>
                  <Link href="/admin" onClick={() => setMoreOpen(false)} className="block">
                    <MobileMenuRow icon={ShieldCheck} label="Admin" active={pathname === "/admin" || pathname.startsWith("/admin/")} />
                  </Link>
                </div>
              )}
            </nav>
            <div className="border-t border-rule px-3 pt-3">
              <button
                onClick={() => void signOutAndRedirect(router)}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-text-muted active:bg-muted"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
