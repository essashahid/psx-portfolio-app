/**
 * Standing gate #2: is every verified entry still covering the NEWEST period
 * we hold for that company?
 *
 * This is the blind spot that check-verified-drift.ts does NOT cover, and the
 * two fail in different ways:
 *
 *   drift      the entry disagrees with the reference. Something broke.
 *   staleness  the entry still agrees with the reference and is internally
 *              consistent, but a newer filing has landed since it was checked,
 *              so the mark covers an older period than the market is trading
 *              on. NOTHING is wrong with the number; it is simply not the
 *              latest one, and the drift gate stays green throughout.
 *
 * A verification is a snapshot of one row selection at one moment, not a
 * permanent property of a company. Quarterly filings age it automatically.
 *
 * Exits non-zero when anything is stale, so it can gate a pipeline.
 *
 *   npx tsx scripts/check-verified-freshness.ts
 *   npx tsx scripts/check-verified-freshness.ts --quiet   # summary only
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync } from "node:fs";

loadEnvLocal();
const QUIET = process.argv.includes("--quiet");

// Mirrors periodRank in lib/engine/verified.ts. Kept in step with it: Q3 and
// 9M are the same point in the year, and FY is the end of it.
const WITHIN: Record<string, number> = { Q1: 1, H1: 2, Q2: 2, "9M": 3, Q3: 3, Q4: 4, FY: 4 };

function rankFromParts(year: number, period: string): number {
  return year * 10 + (WITHIN[period.toUpperCase()] ?? 0);
}

/** Parse a registry throughPeriod such as "TTM to 2026 9M" or "2025 FY". */
function rankFromThroughPeriod(s: string): { rank: number; label: string } | null {
  const m = s.trim().toUpperCase().match(/(\d{4})\s*(FY|9M|H1|H2|Q[1-4])/);
  if (!m) return null;
  return { rank: rankFromParts(Number(m[1]), m[2]), label: `${m[1]} ${m[2]}` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function page<T>(db: any, table: string, sel: string, apply?: (q: never) => never): Promise<T[]> {
  const out: T[] = [];
  const P = 1000;
  for (let f = 0; ; f += P) {
    let q = db.from(table).select(sel).range(f, f + P - 1) as never;
    if (apply) q = apply(q);
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < P) break;
  }
  return out;
}

type Fin = { ticker: string; fiscal_year: number | null; fiscal_period: string | null };

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const reg = JSON.parse(readFileSync("data/verified-tickers.json", "utf8")).verified as Record<string, { throughPeriod?: string; basis?: string; source?: string }>;

  // The newest period we actually HOLD per ticker, from income statements
  // only — a balance sheet alone does not move the earnings chain forward.
  const fins = await page<Fin>(db, "company_financials", "ticker,fiscal_year,fiscal_period", ((q: never) =>
    (q as unknown as { eq: (a: string, b: string) => never }).eq("statement_type", "income_statement")) as never);

  const newest = new Map<string, { rank: number; label: string }>();
  for (const f of fins) {
    if (!f.fiscal_year || !f.fiscal_period) continue;
    const rank = rankFromParts(f.fiscal_year, f.fiscal_period);
    const cur = newest.get(f.ticker);
    if (!cur || rank > cur.rank) newest.set(f.ticker, { rank, label: `${f.fiscal_year} ${f.fiscal_period.toUpperCase()}` });
  }

  const stale: string[] = [];
  const unparsed: string[] = [];
  let current = 0;

  for (const [ticker, entry] of Object.entries(reg)) {
    const through = rankFromThroughPeriod(entry.throughPeriod ?? "");
    if (!through) {
      unparsed.push(`${ticker.padEnd(8)} unparseable throughPeriod: "${entry.throughPeriod}"`);
      continue;
    }
    const have = newest.get(ticker);
    if (!have) {
      unparsed.push(`${ticker.padEnd(8)} verified but no income statements held`);
      continue;
    }
    if (have.rank > through.rank) {
      stale.push(`${ticker.padEnd(8)} verified through ${through.label.padEnd(8)} but we now hold ${have.label.padEnd(8)} [${entry.source ?? "?"}]`);
    } else {
      current++;
    }
  }

  console.log(`verified registry: ${Object.keys(reg).length} entries`);
  console.log(`  covering the newest period held: ${current}`);
  console.log(`  STALE (newer data has landed):   ${stale.length}`);
  if (unparsed.length) console.log(`  could not evaluate:              ${unparsed.length}`);

  if (!QUIET && unparsed.length) console.log(`\ncould not evaluate:\n  ${unparsed.join("\n  ")}`);
  if (!QUIET && stale.length) {
    console.log(`\nSTALE — the figure is not wrong, it is just no longer the latest:\n  ${stale.join("\n  ")}`);
    console.log(`\nRe-read the newer filing and update the entry's throughPeriod. Until then the`);
    console.log(`UI shows these as "verified, newer filing available" rather than plain verified,`);
    console.log(`so users are not told a stale figure has been checked against current data.`);
  }

  if (stale.length || unparsed.length) process.exit(1);
  console.log(`\nall current.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
