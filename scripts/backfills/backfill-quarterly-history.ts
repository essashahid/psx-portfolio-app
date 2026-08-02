import { loadEnvLocal } from "../lib/load-env";

/**
 * Build a complete discrete-quarter EPS history for one company.
 *
 * The quarterly series the stock page draws comes from the PSX company page,
 * which publishes a rolling four columns and nothing older. OGDC's read as
 * Q3 FY2026, Q1 FY2026, Q3 FY2025, Q2 FY2025 — four quarters, one year-on-year
 * pair, three dashes. That is the whole of what that source will ever give.
 *
 * The filings hold the rest. Two things stand between them and a full series:
 *
 *   REACH   PSX serves at most 100 announcement rows per response, and the
 *           extractor only ever read page one. For a busy filer that is under
 *           two years. Paging (getCompanyFilingArchive) reaches back to 2014.
 *
 *   SHAPE   PSX interims are CUMULATIVE. A company files 3M, 6M and 9M, then a
 *           full year. It never files Q2, Q3 or Q4 as a standalone quarter, so
 *           those three of every four quarters do not exist in any document
 *           and have to be differenced out:
 *
 *             Q1 = 3M            Q2 = 6M − 3M
 *             Q3 = 9M − 6M       Q4 = FY − 9M
 *
 * So: page the archive, pick the one best PDF per reporting period, run each
 * through the existing validated extractor, then difference the cumulative
 * rows into discrete quarters. Every derived row carries the two source rows
 * it came from in _derived_from, and is written through the same conflict and
 * identity gate as everything else.
 *
 *   AI_DISABLED=false VISION_DISABLED=false \
 *     npx tsx scripts/backfills/backfill-quarterly-history.ts OGDC --years 5
 *
 *   --dry           plan only: list the filings and derivations, read nothing
 *   --derive-only   skip extraction, just difference what is already stored
 *   --force         re-extract filings already read once
 */

import {
  classifyTitle,
  filingDateMs as dateMs,
  inferFiscalYearEndMonth,
  isReportTitle,
  rankReportTitle as rankTitle,
  type FilingPeriod as Period,
  type FilingTarget as Target,
} from "@/lib/company/filing-periods";

type Candidate = Target & { title: string; url: string; date: string | null; rank: number };

const key = (t: Target) => `FY${t.fiscalYear}-${t.period}`;

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const ticker = (args.find((a) => !a.startsWith("--")) ?? "").toUpperCase();
  if (!ticker) {
    console.error("usage: backfill-quarterly-history.ts <TICKER> [--years 5] [--dry] [--derive-only] [--force]");
    process.exit(1);
  }
  const years = Number(args.find((a) => a.startsWith("--years"))?.split("=")[1] ?? args[args.indexOf("--years") + 1]) || 5;
  const dry = args.includes("--dry");
  const deriveOnly = args.includes("--derive-only");
  const force = args.includes("--force");

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { getCompanyFilingArchive } = await import("@/lib/company/filings");
  const { extractFinancials } = await import("@/lib/engine/financials");
  const db = createAdminClient();

  // ---------------------------------------------------------------------
  // Fiscal calendar. Every period label below depends on it, so a wrong
  // year-end silently mislabels the whole history rather than failing.
  // ---------------------------------------------------------------------
  const { data: meta } = await db
    .from("company_metadata")
    .select("fiscal_year_end_month")
    .eq("ticker", ticker)
    .maybeSingle();
  let fyEndMonth = meta?.fiscal_year_end_month as number | null;

  const archive = await getCompanyFilingArchive(ticker, {
    notBefore: new Date(new Date().getFullYear() - years - 1, 0, 1),
  });
  const reports = archive.filter((f) => f.url.toLowerCase().endsWith(".pdf") && isReportTitle(f.title));

  if (!fyEndMonth) {
    // Read it off the annual filings: their period-end month IS the year end.
    fyEndMonth = inferFiscalYearEndMonth(reports.map((f) => f.title));
    if (!fyEndMonth) {
      console.error(`${ticker}: fiscal year end unknown and not inferable from filing titles. Aborting rather than guessing.`);
      process.exit(1);
    }
    console.log(`${ticker}: fiscal year end inferred as month ${fyEndMonth} from annual filing titles.`);
  }

  console.log(`\n${ticker} — archive: ${archive.length} announcements, ${reports.length} report PDFs, fiscal year ends month ${fyEndMonth}\n`);

  // ---------------------------------------------------------------------
  // One best filing per reporting period.
  // ---------------------------------------------------------------------
  const byTarget = new Map<string, Candidate>();
  const unclassified: string[] = [];
  for (const f of reports) {
    const target = classifyTitle(f.title, fyEndMonth!);
    if (!target) { unclassified.push(`${f.date} | ${f.title}`); continue; }

    const cand: Candidate = { ...target, title: f.title, url: f.url, date: f.date, rank: rankTitle(f.title) };
    const held = byTarget.get(key(target));
    if (!held || cand.rank < held.rank || (cand.rank === held.rank && dateMs(cand.date) > dateMs(held.date))) {
      byTarget.set(key(target), cand);
    }
  }

  // Anchor the window on the newest fiscal year that has actually been filed,
  // not on today's date. A June year-end company is already in FY2027 by every
  // July, but files nothing for it until October — dating the window off the
  // calendar spends a year of the requested five on empty rows.
  const filedYears = [...byTarget.values()].map((c) => c.fiscalYear);
  const currentFy = filedYears.length ? Math.max(...filedYears) : new Date().getFullYear();
  const oldestFy = currentFy - years + 1;

  if (unclassified.length) {
    console.log(`Report PDFs whose period could not be read from the title (${unclassified.length}, skipped):`);
    for (const u of unclassified) console.log(`  ${u}`);
    console.log("");
  }

  // ---------------------------------------------------------------------
  // What is already stored, so we neither re-pay for a filing nor overwrite
  // a good row.
  // ---------------------------------------------------------------------
  const loadStored = async () => {
    const { data } = await db
      .from("company_financials")
      .select("fiscal_year, fiscal_period, period_type, statement_type, source_url, source_type, reporting_basis, review_status, reported_date, updated_at, data")
      .eq("ticker", ticker)
      .eq("statement_type", "income_statement")
      .eq("review_status", "published");
    return data ?? [];
  };
  let stored = await loadStored();
  const storedPeriods = new Set(stored.map((r) => `FY${r.fiscal_year}-${r.fiscal_period}`));

  const wanted: Candidate[] = [];
  for (let fy = oldestFy; fy <= currentFy; fy++) {
    for (const p of ["Q1", "H1", "9M", "FY"] as Period[]) {
      const cand = byTarget.get(key({ fiscalYear: fy, period: p }));
      const have = storedPeriods.has(`FY${fy}-${p}`);
      const status = !cand ? "NOT FILED YET / not on portal" : have && !force ? "already stored" : "EXTRACT";
      console.log(`  FY${fy} ${p.padEnd(2)}  ${status.padEnd(24)} ${cand ? cand.title.slice(0, 72) : ""}`);
      if (cand && (!have || force)) wanted.push(cand);
    }
  }
  console.log(`\n${wanted.length} filing(s) to extract.`);

  // ---------------------------------------------------------------------
  // Extract.
  // ---------------------------------------------------------------------
  if (!dry && !deriveOnly && wanted.length) {
    for (const [i, f] of wanted.entries()) {
      process.stdout.write(`\n[${i + 1}/${wanted.length}] FY${f.fiscalYear} ${f.period} — ${f.title.slice(0, 64)}\n`);
      const r = await extractFinancials(ticker, 1, force, [{ url: f.url, title: f.title, date: f.date }]);
      console.log(`    saved ${r.saved}, processed ${r.processed}`);
      for (const s of r.skipped) console.log(`    skipped: ${s}`);
      for (const e of r.errors) console.log(`    error:   ${e}`);
    }
    stored = await loadStored();
  }

  if (dry) {
    console.log("\n--dry: stopping before extraction and derivation.");
    return;
  }

  // ---------------------------------------------------------------------
  // Repair comparative bleed, then difference the cumulative rows into
  // discrete quarters. Both live in lib/engine/quarterly-derivation so the
  // engine cron runs exactly the same logic on every new filing: a one-off
  // backfill that the scheduled pipeline cannot maintain decays from the day
  // it finishes.
  // ---------------------------------------------------------------------
  const { deriveQuarters } = await import("@/lib/engine/quarterly-derivation");
  const r = await deriveQuarters(db, ticker, { years });

  if (r.bleedRepaired || r.bleedQuarantined) {
    console.log(`\nComparative bleed: ${r.bleedRepaired} relabelled from the same filing's other column, ${r.bleedQuarantined} quarantined.`);
  }
  if (r.gaps.length) {
    console.log(`\nQuarters that could not be derived (${r.gaps.length}):`);
    for (const g of r.gaps) console.log(`  ${g}`);
  }
  if (r.crossChecks.length) {
    console.log(`\nCross-check against quarters PSX reports directly (${r.crossChecks.length}):`);
    for (const c of r.crossChecks) {
      console.log(
        `  ${c.period}: stored ${c.reported.toFixed(2)} vs derived ${c.derived.toFixed(2)} (${c.offPct.toFixed(1)}% apart)${c.material ? "  <-- CHECK" : ""}`
      );
    }
  }
  console.log(`\n${r.written} quarter(s) written, ${r.needsReview} staged for review.`);

  console.log(`\nDone. Reload the stock page for ${ticker}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
