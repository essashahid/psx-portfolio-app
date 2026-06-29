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

export type AppFeatureHref = (typeof ALL_APP_FEATURES)[number];
export type AccountFeature = (typeof ALL_ACCOUNT_FEATURES)[number];

const APP_FEATURE_SET = new Set<string>(ALL_APP_FEATURES);
const ACCOUNT_FEATURE_SET = new Set<string>(ALL_ACCOUNT_FEATURES);
const ADMIN_ONLY_FEATURE_SET = new Set<string>(ADMIN_ONLY_FEATURES);

export function normalizeEnabledFeatures(value: unknown): AccountFeature[] {
  const source = Array.isArray(value) ? value : LAUNCH_DEFAULT_FEATURES;
  const seen = new Set<string>();
  const enabled: AccountFeature[] = [];
  for (const href of source) {
    if (typeof href !== "string" || !ACCOUNT_FEATURE_SET.has(href) || seen.has(href)) continue;
    seen.add(href);
    enabled.push(href as AccountFeature);
  }
  if (!enabled.includes("/dashboard")) enabled.unshift("/dashboard");
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
