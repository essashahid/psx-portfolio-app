import type { SupabaseClient } from "@supabase/supabase-js";

export const LAUNCH_DEFAULT_FEATURES = [
  "/dashboard",
  "/holdings",
  "/dividends",
  "/stocks",
  "/market",
  "/chat",
] as const;

export const ALL_APP_FEATURES = [
  "/dashboard",
  "/holdings",
  "/dividends",
  "/performance",
  "/research",
  "/stocks",
  "/market",
  "/outlook",
  "/bulls-bears",
  "/news",
  "/chat",
  "/goals",
  "/allocation",
  "/journal",
  "/alerts",
  "/import",
  "/coverage",
  "/settings",
] as const;

export const ACCOUNT_CAPABILITIES = [
  "company_enrichment",
  "company_reports",
] as const;

export const ALL_ACCOUNT_FEATURES = [
  ...ALL_APP_FEATURES,
  ...ACCOUNT_CAPABILITIES,
] as const;

export const ADMIN_ONLY_FEATURES = ["/bulls-bears", "/allocation", "/coverage"] as const;

/**
 * Built, but not finished enough to put in front of anyone yet. Hidden from
 * navigation on both the web and the phone; the routes still resolve, so work
 * can continue by typing the URL.
 *
 * These are web hrefs. The phone matches them against an entry's `web` target,
 * not its native route, because the two namespaces collide: /research is the
 * saved-report viewer on the web and the stock screener on the phone. Matching
 * blindly on path would have withdrawn a screen that is finished and in use.
 */
export const UNRELEASED_FEATURES = [
  "/performance",
  "/research",
  "/outlook",
  "/goals",
  "/allocation",
  "/journal",
  "/import",
  "/coverage",
] as const;

const UNRELEASED_FEATURE_SET = new Set<string>(UNRELEASED_FEATURES);

/** Whether a destination should be kept out of menus for now. */
export function isUnreleased(href: string): boolean {
  return UNRELEASED_FEATURE_SET.has(href);
}

export type AppFeatureHref = (typeof ALL_APP_FEATURES)[number];
export type AccountFeature = (typeof ALL_ACCOUNT_FEATURES)[number];

const APP_FEATURE_SET = new Set<string>(ALL_APP_FEATURES);
const ACCOUNT_FEATURE_SET = new Set<string>(ALL_ACCOUNT_FEATURES);
const ADMIN_ONLY_FEATURE_SET = new Set<string>(ADMIN_ONLY_FEATURES);

/**
 * Destinations every account can always reach, whatever its stored feature
 * list says.
 *
 * These are not optional tabs — they are where the app's own chrome sends you.
 * The header renders an alert bell with a live count for everyone, and the
 * account menu offers settings for everyone; a stored list that omits them
 * leaves those controls pointing at a redirect. That is exactly what happened:
 * no account had /alerts enabled, so clicking the bell bounced to /dashboard,
 * and two accounts could not open their own settings.
 *
 * /dashboard was already forced in for the same reason — it is the redirect
 * target itself, so losing it would loop.
 */
const ALWAYS_ENABLED: AccountFeature[] = ["/dashboard", "/alerts", "/settings"];

export function normalizeEnabledFeatures(value: unknown): AccountFeature[] {
  const source = Array.isArray(value) ? value : LAUNCH_DEFAULT_FEATURES;
  const seen = new Set<string>();
  const enabled: AccountFeature[] = [];
  for (const href of source) {
    if (typeof href !== "string" || !ACCOUNT_FEATURE_SET.has(href) || seen.has(href)) continue;
    seen.add(href);
    enabled.push(href as AccountFeature);
  }
  for (const href of ALWAYS_ENABLED) if (!enabled.includes(href)) enabled.unshift(href);
  return enabled;
}

export function featureForPath(pathname: string): AppFeatureHref | null {
  const match = ALL_APP_FEATURES
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? null;
}

export function featureAllowed(
  href: AppFeatureHref,
  enabledFeatures: unknown,
  isRealAdmin: boolean
): boolean {
  if (ADMIN_ONLY_FEATURE_SET.has(href) && !isRealAdmin) return false;
  // Unreleased work is reachable by the admin who is building it and nobody
  // else. Hiding it from menus alone would still leave the URL guessable, and
  // a half-finished screen is worse found by accident than not found at all.
  if (UNRELEASED_FEATURE_SET.has(href) && !isRealAdmin) return false;
  return normalizeEnabledFeatures(enabledFeatures).includes(href);
}

export async function accountHasFeature(
  supabase: SupabaseClient,
  userId: string,
  href: AccountFeature
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("enabled_features")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (APP_FEATURE_SET.has(href)) return featureAllowed(href as AppFeatureHref, data?.enabled_features, false);
  return normalizeEnabledFeatures(data?.enabled_features).includes(href);
}

export const CHAT_PROVIDERS = ["claude", "deepseek"] as const;
export type ChatProvider = (typeof CHAT_PROVIDERS)[number];

const CHAT_PROVIDER_SET = new Set<string>(CHAT_PROVIDERS);

export function normalizeAllowedChatProviders(value: unknown): ChatProvider[] {
  if (!Array.isArray(value)) return [...CHAT_PROVIDERS];
  const seen = new Set<string>();
  const allowed: ChatProvider[] = [];
  for (const provider of value) {
    if (typeof provider !== "string" || !CHAT_PROVIDER_SET.has(provider) || seen.has(provider)) continue;
    seen.add(provider);
    allowed.push(provider as ChatProvider);
  }
  return allowed;
}
