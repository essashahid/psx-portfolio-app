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
//
// The match is deliberately NOT anchored. Registry entries record the period
// as a trailing chain ("TTM to 2026 9M"), while stored rows are bare ("2026
// 9M"). An anchored pattern silently failed on the former and returned 0,
// which made every "TTM to ..." entry rank below any real period and report
// as stale — that is, almost the entire registry, including entries checked
// against the very period they were being compared to.
//
// Q2 and H1 are the same point in the year, as are Q3 and 9M.
function periodRank(period: string | null | undefined): number {
  if (!period) return 0;
  const m = period.trim().toUpperCase().match(/(\d{4})\s*(FY|9M|H1|H2|Q[1-4])/);
  if (!m) return 0;
  const year = Number(m[1]);
  const within: Record<string, number> = { Q1: 1, H1: 2, Q2: 2, "9M": 3, Q3: 3, Q4: 4, H2: 4, FY: 4 };
  return year * 10 + (within[m[2]] ?? 0);
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

/**
 * The newest period among stored financial rows, as a label periodRank can
 * read ("2026 9M"). Ranking lives here rather than at each call site so the
 * UI and scripts/check-verified-freshness.ts cannot drift apart on what
 * counts as "newer".
 *
 * Pass INCOME STATEMENT rows only. A balance sheet alone does not move the
 * earnings chain forward, so counting one would report a company as having
 * newer data when its EPS series has not actually advanced.
 */
export function latestPeriodLabel(
  rows: { fiscal_year: number | null; fiscal_period: string | null }[]
): string | null {
  let best: { rank: number; label: string } | null = null;
  for (const r of rows) {
    if (!r.fiscal_year || !r.fiscal_period) continue;
    const label = `${r.fiscal_year} ${r.fiscal_period.toUpperCase()}`;
    const rank = periodRank(label);
    if (rank === 0) continue;
    if (!best || rank > best.rank) best = { rank, label };
  }
  return best?.label ?? null;
}
