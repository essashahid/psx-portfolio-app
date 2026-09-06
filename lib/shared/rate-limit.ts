import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limit backed by request_counters (migration 0046).
 *
 * Serverless functions do not share memory, so an in-process counter limits
 * one instance and nothing else. One atomic round trip per request is the
 * price of a limit that actually holds. When the database is unreachable the
 * request is allowed: a limiter that fails closed turns a database blip into
 * a total outage.
 */
export interface RateLimitRule {
  /** Namespace, for example "chat" or "waitlist". */
  name: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
  const fallback = { allowed: true, count: 0, limit: rule.limit, retryAfterSeconds: 0 };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fallback;
  try {
    const { data, error } = await createAdminClient().rpc("bump_counter", {
      p_key: `${rule.name}:${subject}`,
      p_window_seconds: rule.windowSeconds,
    });
    if (error || typeof data !== "number") return fallback;
    const now = Math.floor(Date.now() / 1000);
    const windowEnd = (Math.floor(now / rule.windowSeconds) + 1) * rule.windowSeconds;
    return { allowed: data <= rule.limit, count: data, limit: rule.limit, retryAfterSeconds: Math.max(1, windowEnd - now) };
  } catch {
    return fallback;
  }
}

/** The caller's address, for limits on unauthenticated routes. */
export function clientAddress(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** A 429 with a plain message and Retry-After, or null when allowed. */
export async function rateLimitResponse(
  rule: RateLimitRule,
  subject: string,
  message = "Too many requests. Please wait a moment and try again."
): Promise<NextResponse | null> {
  const r = await checkRateLimit(rule, subject);
  if (r.allowed) return null;
  return NextResponse.json({ error: message, retryAfterSeconds: r.retryAfterSeconds }, {
    status: 429,
    headers: { "Retry-After": String(r.retryAfterSeconds) },
  });
}

export const RATE_LIMITS = {
  /** Copilot: burst limit per user; the daily cap lives in the chat route. */
  chat: { name: "chat", limit: 10, windowSeconds: 60 },
  /** Manual price refresh per user. */
  priceRefresh: { name: "price-refresh", limit: 6, windowSeconds: 600 },
  /** News refresh per user. */
  newsRefresh: { name: "news-refresh", limit: 3, windowSeconds: 600 },
  /** Waitlist form per address. */
  waitlist: { name: "waitlist", limit: 5, windowSeconds: 3600 },
  /** Demo session creation per address. */
  demo: { name: "demo", limit: 20, windowSeconds: 3600 },
  /** Telemetry per subject. */
  events: { name: "events", limit: 600, windowSeconds: 3600 },
  errors: { name: "errors", limit: 60, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;
