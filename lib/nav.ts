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
} from "lucide-react";
import type { ComponentType } from "react";
import type { ExperienceLevel, Profile } from "@/lib/types";

/**
 * Navigation is grouped into labelled sections and each item carries a `tier`.
 * The tier, combined with the user's experience level and their personal
 * opt-in / opt-out lists, decides which destinations appear. This keeps invited
 * newcomers on a small, useful map while letting advanced users see everything.
 *
 *  - core     → everyone, including a first-time beginner
 *  - plus     → intermediate and advanced by default
 *  - advanced → advanced only, or anyone who opts in from Settings
 */
export type NavTier = "core" | "plus" | "advanced";

export type NavItemDef = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  hint: string;
  tier: NavTier;
  /**
   * Admin-only destinations are hidden from every public user regardless of
   * tier or opt-in, and only appear for accounts with profiles.is_admin. Used
   * for internal tooling and features kept out of the public launch (the data
   * engine, the weekly Bulls & Bears brief, the allocation forecaster).
   */
  adminOnly?: boolean;
};

export const NAV_SECTIONS: { title: string; items: NavItemDef[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "Your portfolio at a glance", tier: "core" },
      { href: "/holdings", label: "Holdings", icon: Briefcase, hint: "Positions, P/L and weights", tier: "core" },
      { href: "/dividends", label: "Dividends", icon: HandCoins, hint: "Payouts received and forecast", tier: "core" },
      { href: "/performance", label: "Performance", icon: TrendingUp, hint: "XIRR, cost basis, friction and concentration analytics", tier: "core" },
    ],
  },
  {
    title: "Research",
    items: [
      { href: "/research", label: "Saved Reports", icon: FileText, hint: "Company research reports library", tier: "plus" },
      { href: "/stocks", label: "Stock Research", icon: Search, hint: "Fundamentals, ratios and structure per stock", tier: "plus" },
      { href: "/market", label: "Market Pulse", icon: Activity, hint: "Index, breadth, sectors and flows", tier: "plus" },
      { href: "/bulls-bears", label: "Bulls & Bears", icon: BarChart3, hint: "Weekly regime, picks and watchlist", tier: "advanced", adminOnly: true },
      { href: "/news", label: "News Center", icon: Newspaper, hint: "Portfolio and market news", tier: "plus" },
      { href: "/chat", label: "Research Copilot", icon: Sparkles, hint: "Ask anything about your portfolio and PSX", tier: "core" },
    ],
  },
  {
    title: "Planning",
    items: [
      { href: "/goals", label: "Goals & Targets", icon: Target, hint: "Targets and progress", tier: "plus" },
      { href: "/allocation", label: "Capital Allocation", icon: PieChart, hint: "Where to deploy new capital across asset classes", tier: "plus", adminOnly: true },
      { href: "/journal", label: "Journal", icon: NotebookPen, hint: "Your decisions and notes", tier: "advanced" },
      { href: "/alerts", label: "Alerts", icon: Bell, hint: "Triggered watch conditions", tier: "advanced" },
    ],
  },
  {
    title: "Data & setup",
    items: [
      { href: "/import", label: "Import Center", icon: Upload, hint: "Import statements and transactions", tier: "core" },
      { href: "/coverage", label: "Data Engine", icon: Database, hint: "Data coverage and provider health", tier: "advanced", adminOnly: true },
      { href: "/settings", label: "Settings", icon: Settings, hint: "Preferences and account", tier: "core" },
    ],
  },
];

export const NAV = NAV_SECTIONS.flatMap((s) => s.items);

/**
 * Optional tabs a user can show or hide from Settings (everything above core,
 * excluding admin-only tools which are never user-configurable).
 */
export const OPTIONAL_NAV = NAV.filter((item) => item.tier !== "core" && !item.adminOnly);

export function tiersFor(level: ExperienceLevel): NavTier[] {
  if (level === "beginner") return ["core"];
  if (level === "advanced") return ["core", "plus", "advanced"];
  return ["core", "plus"];
}

/** Whether a nav item is shown by default at a given experience level. */
export function isDefaultVisible(item: NavItemDef, level: ExperienceLevel): boolean {
  return tiersFor(level).includes(item.tier);
}

/**
 * Given the user's chosen experience level and the exact set of optional hrefs
 * they want visible, derive the stored opt-in / opt-out lists. This keeps the
 * stored preferences minimal: only deviations from the tier defaults are saved,
 * so changing experience level later still behaves sensibly.
 */
export function deriveFeaturePrefs(
  level: ExperienceLevel,
  visibleOptionalHrefs: Set<string>
): { extra_features: string[]; hidden_features: string[] } {
  const extra: string[] = [];
  const hidden: string[] = [];
  for (const item of OPTIONAL_NAV) {
    const defaultOn = isDefaultVisible(item, level);
    const wantOn = visibleOptionalHrefs.has(item.href);
    if (wantOn && !defaultOn) extra.push(item.href);
    if (!wantOn && defaultOn) hidden.push(item.href);
  }
  return { extra_features: extra, hidden_features: hidden };
}

type NavPrefs = Pick<Profile, "experience_level" | "extra_features" | "hidden_features">;

/**
 * Resolve the set of nav hrefs a user should see:
 *   tier defaults (by experience) ∪ explicit opt-ins, minus explicit opt-outs.
 * Core items can never be hidden so the app stays usable.
 */
export function resolveVisibleHrefs(prefs: NavPrefs, isAdmin = false): string[] {
  const allowedTiers = new Set(tiersFor(prefs.experience_level ?? "intermediate"));
  const extra = new Set(prefs.extra_features ?? []);
  const hidden = new Set(prefs.hidden_features ?? []);
  return NAV.filter((item) => {
    // Admin-only tools are hidden from every public user, shown to admins.
    if (item.adminOnly) return isAdmin;
    if (item.tier === "core") return true;
    if (hidden.has(item.href)) return false;
    return allowedTiers.has(item.tier) || extra.has(item.href);
  }).map((item) => item.href);
}
