/**
 * Measure the blast radius of the filing-selection bug fixed in
 * lib/engine/financials.ts.
 *
 * Two defects were serving the WRONG document, silently:
 *   1. "Annual Financial Statements" was not recognised as an annual report
 *      (only "annual report" / "annual account" were), so companies filing
 *      under that spelling had their annual slot fall through to the PRIOR
 *      YEAR's report. Nothing errors; the figures just quietly describe the
 *      wrong year.
 *   2. Announcements ABOUT the accounts ("Advertisement regarding Credit of
 *      Interim Dividend for the half year ended...") matched on period
 *      wording and, being newer than the accounts themselves, won the interim
 *      slot. A newspaper notice then stood in for financial statements.
 *
 * This runs BOTH matchers over the same live filing feed for every company
 * and reports where they disagree. It only LISTS filings — nothing is
 * downloaded, so it costs no disk. Read-only: it writes no database rows.
 *
 *   npx tsx scripts/audit-filing-selection.ts            # whole universe
 *   npx tsx scripts/audit-filing-selection.ts --limit 40 # quick sample
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const CONCURRENCY = 8;

type Filing = { title: string; date: string | null };

// ---- the matcher as it WAS (the buggy version) ----
const isReportOld = (f: Filing) =>
  /transmission|quarterly report|half[\s-]?year|annual report|annual account|condensed interim/i.test(f.title) &&
  !/revoked|withdrawn|cancell?ed|shariah/i.test(f.title);
const isAnnualOld = (t: string) => /annual report|annual account/i.test(t);

// ---- the matcher as it IS now (fixed) ----
const isReportNew = (f: Filing) =>
  /transmission|quarterly report|half[\s-]?year|annual report|annual account|annual financial statement|condensed interim/i.test(f.title) &&
  !/revoked|withdrawn|cancell?ed|shariah/i.test(f.title) &&
  !/advertisement|intimation|notice|credit of|board meeting|video recording|presentation|briefing|unclaim|un-?paid/i.test(f.title);
const isAnnualNew = (t: string) => /annual report|annual account|annual financial statement/i.test(t);

/** Pull a 4-digit year out of a filing title, for reporting how stale a pick was. */
function titleYear(t: string): number | null {
  const m = t.match(/\b(20\d{2})\b/g);
  if (!m) return null;
  return Math.max(...m.map(Number));
}

type Verdict = {
  ticker: string;
  annualOld: string | null;
  annualNew: string | null;
  interimOld: string | null;
  interimNew: string | null;
  yearsStale: number | null;
};

async function auditTicker(ticker: string, getCompanyFilings: (t: string, n: number) => Promise<Filing[]>): Promise<Verdict | null> {
  try {
    let filings = await getCompanyFilings(ticker, 40);
    if (!filings.some((f) => isReportNew(f) && isAnnualNew(f.title))) {
      filings = await getCompanyFilings(ticker, 200);
    }
    const oldPool = filings.filter(isReportOld);
    const newPool = filings.filter(isReportNew);

    const annualOld = oldPool.find((f) => isAnnualOld(f.title))?.title ?? null;
    const annualNew = newPool.find((f) => isAnnualNew(f.title))?.title ?? null;
    const interimOld = oldPool.find((f) => !isAnnualOld(f.title))?.title ?? null;
    const interimNew = newPool.find((f) => !isAnnualNew(f.title))?.title ?? null;

    if (annualOld === annualNew && interimOld === interimNew) return null;

    // How many years of staleness the old pick carried, when both name a year.
    const yo = annualOld ? titleYear(annualOld) : null;
    const yn = annualNew ? titleYear(annualNew) : null;
    const yearsStale = yo != null && yn != null ? yn - yo : null;

    return { ticker, annualOld, annualNew, interimOld, interimNew, yearsStale };
  } catch {
    return null;
  }
}

async function main() {
  const { getCompanyFilings } = await import("@/lib/company/filings");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  // Only companies we actually hold financials for: a selection bug on a
  // company with no stored data has harmed nothing yet.
  // PAGINATE. A bare select caps at 1000 rows, and at roughly 11 income rows
  // per company that silently truncated the universe to the first ~92 tickers
  // alphabetically — an audit that looks complete while covering A through B.
  const seen = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("company_financials")
      .select("ticker")
      .eq("statement_type", "income_statement")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) seen.add(r.ticker as string);
    if (!data || data.length < PAGE) break;
  }
  const tickers = [...seen].sort().slice(0, LIMIT);
  console.log(`auditing ${tickers.length} companies that have stored financials\n`);

  const queue = [...tickers];
  const hits: Verdict[] = [];
  let done = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const t = queue.shift();
      if (!t) break;
      const v = await auditTicker(t, getCompanyFilings);
      done++;
      if (v) hits.push(v);
      if (done % 50 === 0) console.log(`  ${done}/${tickers.length} checked, ${hits.length} affected so far`);
    }
  });
  await Promise.all(workers);

  const staleAnnual = hits.filter((h) => h.annualOld !== h.annualNew);
  const badInterim = hits.filter((h) => h.interimOld !== h.interimNew);
  const yearStale = staleAnnual.filter((h) => (h.yearsStale ?? 0) > 0);

  console.log(`\n=== ${hits.length} of ${tickers.length} companies affected ===`);
  console.log(`  annual pick changed:  ${staleAnnual.length}  (of which ${yearStale.length} were serving an OLDER year)`);
  console.log(`  interim pick changed: ${badInterim.length}`);

  if (yearStale.length) {
    console.log(`\n--- SERVING A STALE ANNUAL (worst first) ---`);
    for (const h of yearStale.sort((a, b) => (b.yearsStale ?? 0) - (a.yearsStale ?? 0))) {
      console.log(`  ${h.ticker.padEnd(8)} ${h.yearsStale}yr stale`);
      console.log(`      was: ${h.annualOld ?? "(none found)"}`);
      console.log(`      now: ${h.annualNew}`);
    }
  }

  const annualFound = staleAnnual.filter((h) => !h.annualOld && h.annualNew);
  if (annualFound.length) {
    console.log(`\n--- ANNUAL FOUND WHERE PREVIOUSLY NONE (${annualFound.length}) ---`);
    for (const h of annualFound) console.log(`  ${h.ticker.padEnd(8)} ${h.annualNew}`);
  }

  if (badInterim.length) {
    console.log(`\n--- INTERIM WAS A NOTICE/ADVERTISEMENT (${badInterim.length}) ---`);
    for (const h of badInterim) {
      console.log(`  ${h.ticker.padEnd(8)}`);
      console.log(`      was: ${h.interimOld ?? "(none)"}`);
      console.log(`      now: ${h.interimNew ?? "(none)"}`);
    }
  }

  console.log(`\nNOTE: this compares FILING SELECTION only. A changed pick means the`);
  console.log(`stored figures for that company were extracted from the wrong document`);
  console.log(`and should be re-extracted. It does not by itself prove the stored`);
  console.log(`numbers are wrong — some companies restate little year to year.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
