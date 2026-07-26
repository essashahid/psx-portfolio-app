import { redirect } from "next/navigation";
import { createClient, getEffectiveUser } from "@/lib/supabase/server";
import { MobileBottomNav, MobileTopBar, TopNav } from "@/components/shared/top-nav";
import { MarketTickerTape, type TickerItem } from "@/components/shared/market-ticker-tape";
import { AutoRefreshPrices } from "@/components/shared/auto-refresh-prices";
import { NavProgress } from "@/components/shared/nav-progress";
import { ImpersonationBanner } from "@/components/shared/impersonation-banner";
import { FeedbackWidget } from "@/components/shared/feedback-widget";
import { CommandPalette } from "@/components/shared/command-palette";
import { formatNumber, formatSignedPct } from "@/lib/shared/format";
import { NAV, resolveVisibleHrefs } from "@/lib/config/navigation";
import { getCachedMarketGlobal } from "@/lib/market/read";
import { getCachedTickerExtras } from "@/lib/market/ticker-extras";
import type { ExperienceLevel } from "@/lib/shared/types";

const fmtCompactNum = (v: number) =>
  v >= 1e9 ? `${formatNumber(v / 1e9, 1)}bn` : v >= 1e6 ? `${formatNumber(v / 1e6, 0)}m` : formatNumber(v, 0);

async function getTickerItems(): Promise<TickerItem[]> {
  const [{ snapshot, movers }, extras] = await Promise.all([
    getCachedMarketGlobal(),
    getCachedTickerExtras().catch(() => []),
  ]);
  if (!snapshot) return extras;
  const items: TickerItem[] = [];
  const total = snapshot.total_advancers + snapshot.total_decliners + snapshot.total_unchanged || 1;
  if (snapshot.snapshot_time) {
    items.push({ label: "As of", value: `${String(snapshot.snapshot_time).slice(0, 5)} PKT`, change: snapshot.snapshot_date, tone: "flat" });
  }
  if (snapshot.index_name && snapshot.index_value !== null) {
    items.push({
      label: snapshot.index_name,
      value: formatNumber(snapshot.index_value, 0),
      change: snapshot.index_change_percent !== null ? `${snapshot.index_change !== null ? formatNumber(snapshot.index_change, 0) + " " : ""}(${formatSignedPct(snapshot.index_change_percent)})` : undefined,
      tone: (snapshot.index_change_percent ?? 0) > 0 ? "up" : (snapshot.index_change_percent ?? 0) < 0 ? "down" : "flat",
    });
  }
  items.push({
    label: "Breadth",
    value: `${Math.round((snapshot.total_advancers / total) * 100)}%`,
    change: "advancing",
    tone: snapshot.total_advancers > snapshot.total_decliners ? "up" : "down",
  });
  items.push({ label: "Volume", value: fmtCompactNum(snapshot.total_volume) });
  items.push({ label: "Value traded", value: fmtCompactNum(snapshot.total_value) });
  const gainer = movers.find((m) => m.category.includes("gain"));
  const loser = movers.find((m) => m.category.includes("los"));
  if (gainer?.change_percent != null) items.push({ label: "Top gainer", value: gainer.ticker, change: formatSignedPct(gainer.change_percent), tone: "up" });
  if (loser?.change_percent != null) items.push({ label: "Top loser", value: loser.ticker, change: formatSignedPct(loser.change_percent), tone: "down" });
  if (snapshot.top_sector) items.push({ label: "Top sector", value: snapshot.top_sector, tone: "up" });
  if (snapshot.bottom_sector) items.push({ label: "Bottom sector", value: snapshot.bottom_sector, tone: "down" });
  items.push(...extras);
  return items;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const effective = await getEffectiveUser();
  if (!effective) redirect("/login");

  const { user, realUser, isImpersonating } = effective;

  // When impersonating, the admin's client has override RLS so it can read the
  // impersonated user's profile. We load alerts and profile for the effective
  // user (the customer), so the admin sees exactly what the customer sees.
  const [{ count }, profileRes, tickerItems] = await Promise.all([
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
    getTickerItems(),
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

  const navTargets = NAV.filter((item) => visibleHrefs.includes(item.href)).map((item) => ({
    href: item.href,
    label: item.label,
    hint: item.hint,
  }));

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div aria-hidden className="om-grain" />
      <NavProgress />
      <AutoRefreshPrices />
      <CommandPalette nav={navTargets} />
      <TopNav email={user.email ?? ""} openAlerts={count ?? 0} visibleHrefs={visibleHrefs} isAdmin={isAdmin} />
      <MobileTopBar openAlerts={count ?? 0} />
      <MarketTickerTape items={tickerItems} />
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
      <main className="scroll-touch flex-1 px-3 py-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4 md:px-(--gutter-page) md:py-8 md:pb-8">
        <div className="w-full">{children}</div>
      </main>
      {user.email === "demo@example.com" && <FeedbackWidget isDemo={isDemo} />}
      <MobileBottomNav email={user.email ?? ""} openAlerts={count ?? 0} visibleHrefs={visibleHrefs} isAdmin={isAdmin} />
    </div>
  );
}
