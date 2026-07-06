import registry from "@/data/verified-tickers.json";

export interface Verification {
  ticker: string;
  throughPeriod: string; // e.g. "2026 9M"
  basis: string;
  source: string;
  date: string;
  note?: string;
}

const VERIFIED: Record<string, Omit<Verification, "ticker">> = (registry as {
  verified: Record<string, Omit<Verification, "ticker">>;
}).verified;

/** The verification record for a ticker, or null if it has never been checked. */
export function getVerification(ticker: string): Verification | null {
  const v = VERIFIED[ticker.toUpperCase()];
  return v ? { ticker: ticker.toUpperCase(), ...v } : null;
}

export function isVerified(ticker: string): boolean {
  return ticker.toUpperCase() in VERIFIED;
}

export function verifiedTickers(): string[] {
  return Object.keys(VERIFIED);
}

// Order a period string like "2026 9M" so a newer filing can be detected.
function periodRank(period: string | null | undefined): number {
  if (!period) return 0;
  const m = period.trim().toUpperCase().match(/^(\d{4})\s*(FY|9M|H1|Q[1-4])?$/);
  if (!m) return 0;
  const year = Number(m[1]);
  const within = { Q1: 1, H1: 2, "9M": 3, Q3: 3, FY: 4 }[m[2] ?? "FY"] ?? 0;
  return year * 10 + within;
}

/**
 * Verification status against the latest period actually on file. "verified"
 * means checked and still current; "stale" means a newer filing has landed
 * since the check, so the mark no longer covers the freshest data; null means
 * never verified.
 */
export function verificationStatus(
  ticker: string,
  latestPeriodOnFile: string | null
): { status: "verified" | "stale"; verification: Verification } | null {
  const v = getVerification(ticker);
  if (!v) return null;
  const stale = periodRank(latestPeriodOnFile) > periodRank(v.throughPeriod);
  return { status: stale ? "stale" : "verified", verification: v };
}
