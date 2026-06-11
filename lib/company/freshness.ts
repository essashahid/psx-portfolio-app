import type { Freshness } from "@/lib/company/types";

/** Minutes after which a cached section is considered stale (serve-then-refresh). */
export const TTL_MINUTES = {
  metadata: 60 * 24 * 7, // company profile rarely changes — 7 days
  technicals: 60 * 12,   // recompute roughly twice a day (EOD-driven)
  filings: 60 * 6,
} as const;

export function freshnessFor(lastFetched: Date | string | null, ttlMinutes: number): Freshness {
  if (!lastFetched) return "missing";
  const t = typeof lastFetched === "string" ? new Date(lastFetched) : lastFetched;
  if (Number.isNaN(t.getTime())) return "missing";
  const ageMin = (Date.now() - t.getTime()) / 60_000;
  return ageMin <= ttlMinutes ? "fresh" : "stale";
}

export function isStaleOrMissing(f: Freshness): boolean {
  return f === "stale" || f === "missing";
}

/** Human label for a freshness badge. */
export function freshnessLabel(f: Freshness): string {
  switch (f) {
    case "fresh": return "Fresh";
    case "stale": return "Stale";
    case "missing": return "No data";
    case "partial": return "Partial";
    case "needs_review": return "Needs review";
  }
}
