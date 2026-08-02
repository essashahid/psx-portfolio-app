import { loadEnvLocal } from "../lib/load-env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Phase 0 of the five-year data programme: what filings exist, for whom.
 *
 * Nothing is downloaded and no AI is called. This walks each company's PSX
 * announcement archive, reads each filing's reporting period off its own
 * title, and records which of the four cumulative periods (Q1, H1, 9M, FY) of
 * each fiscal year are on the portal and which are already stored.
 *
 * It exists because every estimate of the extraction job so far has been a
 * guess. "About twelve filings per company, so about 5,800 PDFs" is arithmetic
 * on an assumption; companies suspend, list late, change year end, and file
 * under titles that state no date. The manifest this writes turns the guess
 * into a count, which is what the scope decision should be made on.
 *
 * It is also the input to every later phase: the extractor should read from a
 * known worklist rather than rediscovering filings live, which is what makes a
 * long run resumable instead of restarting from the network each time.
 *
 *   npx tsx scripts/data/build-filing-archive-inventory.ts                 # whole universe
 *   npx tsx scripts/data/build-filing-archive-inventory.ts --holdings      # just your holdings
 *   npx tsx scripts/data/build-filing-archive-inventory.ts --tickers OGDC,PPL
 *   npx tsx scripts/data/build-filing-archive-inventory.ts --years 5 --limit 20
 *
 * Resumable: a ticker already in the manifest is skipped unless --refresh
 * names it or --force is passed, so an interrupted run continues where it
 * stopped rather than re-walking hundreds of archives.
 */

const MANIFEST = "data/reference/filing-archive-inventory.json";
// The portal is public and nothing obliges it to serve us. One archive walk is
// already several sequential requests, so companies are processed a few at a
// time rather than in a fan-out.
const CONCURRENCY = 3;

const KNOWN_FLAGS = new Set(["years", "limit", "tickers", "refresh", "holdings", "force", "out"]);
for (const a of process.argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const name = a.slice(2).split("=")[0];
  if (!KNOWN_FLAGS.has(name)) {
    console.error(`unknown flag --${name}. Known: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(", ")}`);
    process.exit(1);
  }
}

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0) return process.argv[i + 1] ?? null;
  const inline = process.argv.find((a) => a.startsWith(`--${n}=`));
  return inline ? inline.split("=").slice(1).join("=") : null;
};

const YEARS = Number(arg("years")) || 5;
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const OUT = arg("out") ?? MANIFEST;
const FORCE = process.argv.includes("--force");
const HOLDINGS_ONLY = process.argv.includes("--holdings");
const ONLY = new Set((arg("tickers") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
const REFRESH = new Set((arg("refresh") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));

type PeriodSlot = {
  filed: boolean;
  stored: boolean;
  title?: string;
  date?: string | null;
  url?: string;
  rank?: number;
};

type Entry = {
  ticker: string;
  fiscalYearEndMonth: number | null;
  fiscalYearEndSource: "metadata" | "inferred" | "unknown";
  announcements: number;
  reportPdfs: number;
  /** `FY2024-Q1` -> what the portal has and what we already hold. */
  periods: Record<string, PeriodSlot>;
  /** Report PDFs whose period could not be read from the title. */
  unreadableTitles: string[];
  oldestAnnouncement: string | null;
  checkedAt: string;
  error?: string;
};

function loadManifest(): Record<string, Entry> {
  try {
    return JSON.parse(readFileSync(OUT, "utf8")).entries ?? {};
  } catch {
    return {};
  }
}

function summarise(entries: Record<string, Entry>) {
  const values = Object.values(entries);
  const slots = values.flatMap((e) => Object.values(e.periods));
  const filed = slots.filter((s) => s.filed);
  return {
    companies: values.length,
    companiesWithNoFilings: values.filter((e) => e.reportPdfs === 0).length,
    companiesWithUnknownYearEnd: values.filter((e) => e.fiscalYearEndMonth === null).length,
    periodSlotsExpected: slots.length,
    periodSlotsOnPortal: filed.length,
    periodSlotsAlreadyStored: slots.filter((s) => s.stored).length,
    /** The actual size of the extraction job: filed, not yet stored. */
    filingsToExtract: filed.filter((s) => !s.stored).length,
    unreadableTitles: values.reduce((n, e) => n + e.unreadableTitles.length, 0),
    errored: values.filter((e) => e.error).length,
  };
}

function saveManifest(entries: Record<string, Entry>) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        _note:
          "Phase 0 inventory: which cumulative reporting periods (Q1/H1/9M/FY) each company has on the PSX announcement archive, and which we already hold. No PDFs downloaded, no AI. 'filed' means a report PDF for that period is on the portal; 'stored' means published income-statement rows already exist for it. filingsToExtract is the real size of the extraction job.",
        _asOf: new Date().toISOString(),
        _years: YEARS,
        summary: summarise(entries),
        entries,
      },
      null,
      2
    ) + "\n"
  );
}

async function main() {
  loadEnvLocal();

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const { getCompanyFilingArchive } = await import("@/lib/company/filings");
  const { classifyTitle, filingDateMs, inferFiscalYearEndMonth, isReportTitle, rankReportTitle } =
    await import("@/lib/company/filing-periods");

  const db = createAdminClient();

  let tickers: string[];
  if (ONLY.size) {
    tickers = [...ONLY];
  } else if (HOLDINGS_ONLY) {
    const { data } = await db.from("holdings").select("ticker").gt("quantity", 0);
    tickers = [...new Set((data ?? []).map((r) => String(r.ticker).toUpperCase()))].sort();
  } else {
    tickers = [...new Set(await activeUniverseTickers(db, "companies"))].sort();
  }
  tickers = tickers.slice(0, LIMIT);

  // Fiscal calendars and what is already stored, read once for everyone rather
  // than per company: 482 companies is 482 round trips otherwise.
  const { data: metaRows } = await db.from("company_metadata").select("ticker, fiscal_year_end_month");
  const yearEnds = new Map<string, number>();
  for (const r of metaRows ?? []) {
    const m = r.fiscal_year_end_month as number | null;
    if (m) yearEnds.set(String(r.ticker).toUpperCase(), m);
  }

  const storedPeriods = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("company_financials")
      .select("ticker, fiscal_year, fiscal_period")
      .eq("statement_type", "income_statement")
      .eq("review_status", "published")
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) storedPeriods.add(`${r.ticker}|FY${r.fiscal_year}-${r.fiscal_period}`);
    if (data.length < 1000) break;
  }

  const entries = FORCE ? {} : loadManifest();
  const todo = tickers.filter((t) => FORCE || REFRESH.has(t) || !entries[t]);
  console.log(
    `${tickers.length} companies in scope, ${todo.length} to walk (${tickers.length - todo.length} already in the manifest), ${YEARS}-year window\n`
  );
  if (todo.length === 0) {
    console.log("Nothing to do. Pass --force to re-walk everything, or --refresh TICKER for one.");
    report(entries);
    return;
  }

  const notBefore = new Date(new Date().getFullYear() - YEARS - 1, 0, 1);
  let done = 0;

  async function processTicker(ticker: string): Promise<Entry> {
    const base: Entry = {
      ticker,
      fiscalYearEndMonth: null,
      fiscalYearEndSource: "unknown",
      announcements: 0,
      reportPdfs: 0,
      periods: {},
      unreadableTitles: [],
      oldestAnnouncement: null,
      checkedAt: new Date().toISOString(),
    };

    try {
      const archive = await getCompanyFilingArchive(ticker, { notBefore });
      base.announcements = archive.length;
      base.oldestAnnouncement = archive[archive.length - 1]?.date ?? null;

      const reports = archive.filter((f) => f.url.toLowerCase().endsWith(".pdf") && isReportTitle(f.title));
      base.reportPdfs = reports.length;

      const fromMeta = yearEnds.get(ticker) ?? null;
      const fyEnd = fromMeta ?? inferFiscalYearEndMonth(reports.map((f) => f.title));
      base.fiscalYearEndMonth = fyEnd;
      base.fiscalYearEndSource = fromMeta ? "metadata" : fyEnd ? "inferred" : "unknown";
      // Without a fiscal calendar no title can be turned into a period, so the
      // company is recorded as needing one rather than silently coming back
      // with zero filings, which would read as "nothing on the portal".
      if (!fyEnd) return base;

      const best = new Map<string, { title: string; date: string | null; url: string; rank: number; fy: number; period: string }>();
      for (const f of reports) {
        const target = classifyTitle(f.title, fyEnd);
        if (!target) {
          base.unreadableTitles.push(`${f.date ?? "?"} | ${f.title}`);
          continue;
        }
        const k = `FY${target.fiscalYear}-${target.period}`;
        const rank = rankReportTitle(f.title);
        const held = best.get(k);
        if (!held || rank < held.rank || (rank === held.rank && filingDateMs(f.date) > filingDateMs(held.date))) {
          best.set(k, { title: f.title, date: f.date, url: f.url, rank, fy: target.fiscalYear, period: target.period });
        }
      }

      // The window is anchored on the newest fiscal year actually filed, not on
      // today. A June year-end company is in FY2027 by every July but files
      // nothing for it until October, and dating the window off the calendar
      // spends a year of the requested five on rows that cannot exist.
      //
      // Capped at what the calendar allows as well. The year bound in
      // periodEndFromTitle already rejects a typo like "September 30, 3019",
      // but the anchor is the one value where a single bad title costs a whole
      // company its inventory, so it does not rely on that alone.
      const maxPossibleFy = new Date().getFullYear() + 1;
      const filedYears = [...best.values()].map((b) => b.fy).filter((y) => y <= maxPossibleFy);
      const currentFy = filedYears.length ? Math.max(...filedYears) : new Date().getFullYear();

      for (let fy = currentFy - YEARS + 1; fy <= currentFy; fy++) {
        for (const p of ["Q1", "H1", "9M", "FY"]) {
          const k = `FY${fy}-${p}`;
          const hit = best.get(k);
          base.periods[k] = {
            filed: Boolean(hit),
            stored: storedPeriods.has(`${ticker}|${k}`),
            ...(hit ? { title: hit.title, date: hit.date, url: hit.url, rank: hit.rank } : {}),
          };
        }
      }
      return base;
    } catch (err) {
      base.error = err instanceof Error ? err.message : String(err);
      return base;
    }
  }

  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const ticker = queue.shift();
        if (!ticker) return;
        const entry = await processTicker(ticker);
        entries[ticker] = entry;
        done++;
        const slots = Object.values(entry.periods);
        const toGet = slots.filter((s) => s.filed && !s.stored).length;
        console.log(
          `[${String(done).padStart(3)}/${todo.length}] ${ticker.padEnd(8)} ` +
            `fye=${String(entry.fiscalYearEndMonth ?? "?").padStart(2)} ` +
            `reports=${String(entry.reportPdfs).padStart(3)} ` +
            `onPortal=${String(slots.filter((s) => s.filed).length).padStart(2)}/${slots.length} ` +
            `toExtract=${String(toGet).padStart(2)}` +
            (entry.error ? `  ERROR ${entry.error.slice(0, 60)}` : "")
        );
        // Written every company, so an interrupted run keeps everything it has
        // already paid the network for.
        if (done % 5 === 0) saveManifest(entries);
      }
    })
  );

  saveManifest(entries);
  report(entries);

  function report(all: Record<string, Entry>) {
    const s = summarise(all);
    console.log(`\n${"=".repeat(64)}\nPHASE 0 INVENTORY — ${OUT}\n${"=".repeat(64)}`);
    console.log(`companies                       ${s.companies}`);
    console.log(`  with no report PDFs at all    ${s.companiesWithNoFilings}`);
    console.log(`  with unknown fiscal year end  ${s.companiesWithUnknownYearEnd}`);
    console.log(`\nreporting-period slots (${YEARS}y x 4)  ${s.periodSlotsExpected}`);
    console.log(`  on the portal                 ${s.periodSlotsOnPortal}`);
    console.log(`  already stored                ${s.periodSlotsAlreadyStored}`);
    console.log(`\nFILINGS TO EXTRACT              ${s.filingsToExtract}`);
    console.log(`\ntitles whose period is unreadable ${s.unreadableTitles}`);
    console.log(`companies that errored            ${s.errored}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
