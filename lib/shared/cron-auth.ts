import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared authorization for the scheduled-job routes.
 *
 * Every cron handler used to inline the same four lines, which meant a fix to
 * one of them (constant-time compare, header precedence) silently skipped the
 * other eight. Keeping it here makes the check one thing to audit.
 */

/**
 * Constant-time string compare.
 *
 * `a !== b` on a secret leaks its prefix through timing. The length check
 * before `timingSafeEqual` is unavoidable — that call throws on mismatched
 * buffer lengths — but secret length is not the part worth protecting.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The secret the caller presented, header first.
 *
 * `?key=` is still accepted because external schedulers (an OS cron `curl`,
 * pg_cron) are configured with a URL and nothing else. It is the weaker of the
 * two: query strings land in access logs and `Referer` headers, so anything
 * that can send a header should. Set CRON_REJECT_QUERY_KEY=true once every
 * caller is on the header to close that door.
 */
function presentedSecret(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) return header.replace(/^Bearer\s+/i, "").trim();
  if (process.env.CRON_REJECT_QUERY_KEY === "true") return null;
  return new URL(request.url).searchParams.get("key");
}

export function isCronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided = presentedSecret(request);
  if (!provided) return false;
  return secretsMatch(provided, expected);
}

/**
 * Guard for a cron route: returns a response to send back, or null when the
 * caller is allowed through.
 *
 * A missing CRON_SECRET is 503 rather than 401 on purpose — the job is not
 * unauthorized, the server is not configured to run it, and those need
 * different fixes.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured on the server." }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
