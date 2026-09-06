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
  BarChart3,
  HandCoins,
  Search,
  Database,
  Activity,
  TrendingUp,
  FileText,
  PieChart,
  Radar,
} from "lucide-react";
import type { ComponentType } from "react";
import type { Profile } from "@/lib/shared/types";
import {
  ADMIN_ONLY_FEATURES,
  isUnreleased,
  LAUNCH_DEFAULT_FEATURES,
  normalizeEnabledFeatures,
  type AppFeatureHref,
} from "@/lib/config/features";

/**
 * Navigation is grouped into labelled sections. What a user actually sees is
 * decided by `resolveVisibleHrefs` at the bottom of this file, from the
 * account's `enabled_features` plus `is_admin` for admin-only destinations.
 *
 * Items used to carry a `tier` that combined with the user's experience level
 * and a pair of opt-in / opt-out lists to derive the menu. That model was
 * replaced by explicit per-account flags and stopped affecting visibility; the
 * remains of it were removed in September 2026.
 */
export type NavItemDef = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
  /**
   * Admin-only destinations are hidden from every public user and only appear
   * for accounts with profiles.is_admin. Used
   * for internal tooling and features kept out of the public launch (the data
   * engine, the weekly Bulls & Bears brief, the allocation forecaster).
   */
  adminOnly?: boolean;
};

export const NAV_SECTIONS: { title: string; items: NavItemDef[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Home", icon: LayoutDashboard, hint: "Your portfolio at a glance" },
      { href: "/holdings", label: "Portfolio", icon: Briefcase, hint: "Positions, P/L and weights" },
      { href: "/dividends", label: "Dividends", icon: HandCoins, hint: "Payouts received and forecast" },
    ],
  },
  {
    title: "Research",
    items: [
      { href: "/stocks", label: "Companies", icon: Search, hint: "Fundamentals, ratios and structure per company" },
      { href: "/market", label: "Market", icon: Activity, hint: "Index, breadth, sectors and flows" },
      { href: "/chat", label: "Ask", icon: Sparkles, hint: "Ask anything about your portfolio and PSX" },
      { href: "/news", label: "News", icon: Newspaper, hint: "Portfolio and market news" },
    ],
  },
  {
    title: "Internal",
    items: [
      { href: "/performance", label: "Performance", icon: TrendingUp, hint: "XIRR, cost basis, friction and concentration analytics" },
      { href: "/research", label: "Saved Reports", icon: FileText, hint: "Company research reports library" },
      { href: "/outlook", label: "PSX Market Outlook", icon: Radar, hint: "Early-warning and forecasting system" },
      { href: "/bulls-bears", label: "Bulls & Bears", icon: BarChart3, hint: "Weekly regime, picks and watchlist", adminOnly: true },
      { href: "/goals", label: "Goals & Targets", icon: Target, hint: "Targets and progress" },
      { href: "/allocation", label: "Capital Allocation", icon: PieChart, hint: "Where to deploy new capital across asset classes", adminOnly: true },
      { href: "/journal", label: "Journal", icon: NotebookPen, hint: "Your decisions and notes" },
      { href: "/import", label: "Import Center", icon: Upload, hint: "Import statements and transactions" },
      { href: "/coverage", label: "Data Engine", icon: Database, hint: "Data coverage and provider health", adminOnly: true },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/alerts", label: "Alerts", icon: Bell, hint: "Results, dividends, announcements and concentration" },
      { href: "/settings", label: "Settings", icon: Settings, hint: "Preferences and account" },
    ],
  },
];

/**
 * The six primary destinations, in the order the header shows them. Everything
 * else is chrome (alerts, settings), reachable by link (news) or internal.
 */
export const PRIMARY_NAV_HREFS = ["/dashboard", "/holdings", "/dividends", "/stocks", "/market", "/chat"] as const;

/**
 * Everything defined, including what is not ready to show. Menus read NAV,
 * which has the unreleased destinations filtered out; the routes themselves
 * still resolve so the work can carry on by typing the URL.
 */
export const ALL_NAV = NAV_SECTIONS.flatMap((s) => s.items);

export const NAV = ALL_NAV.filter((item) => !isUnreleased(item.href));
const LAUNCH_DEFAULT_HREFS = new Set<string>(LAUNCH_DEFAULT_FEATURES);
export const LAUNCH_DEFAULT_NAV = NAV.filter((item) => LAUNCH_DEFAULT_HREFS.has(item.href));
const ADMIN_ONLY_HREFS = new Set<string>(ADMIN_ONLY_FEATURES);

/**
 * The admin "Internal" menu: every admin-only route, whether or not it is
 * released. The route guard still decides access; this is only where an admin
 * finds the work in progress without typing the URL.
 */
export const INTERNAL_NAV = ALL_NAV.filter((item) => ADMIN_ONLY_HREFS.has(item.href));

type NavPrefs = Pick<Profile, "enabled_features">;

/**
 * Resolve the set of nav hrefs a user should see, from the account's explicit
 * feature flags. Admin-only destinations additionally require is_admin.
 */
export function resolveVisibleHrefs(prefs: NavPrefs, isAdmin = false): string[] {
  const enabled = new Set(normalizeEnabledFeatures(prefs.enabled_features));
  return NAV.filter((item) => {
    const href = item.href as AppFeatureHref;
    if (item.adminOnly || ADMIN_ONLY_HREFS.has(item.href)) return isAdmin && enabled.has(href);
    return enabled.has(href);
  }).map((item) => item.href);
}
