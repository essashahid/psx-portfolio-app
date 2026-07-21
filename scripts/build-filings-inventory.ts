/**
 * Filing inventory + local cache — phase 1 of a two-phase pipeline.
 *
 * Every extraction run today fetches filings LIVE from PSX at the moment of
 * extraction. That is why the remediation worker had to restart three times:
 * each restart re-downloaded PDFs for companies already processed, and
 * whether a company even HAD an annual report only surfaced mid-run, after
 * paying for the vision call that discovered it (NATF).
 *
 * This script separates "what do we have" from "what do we do with it":
 *   1. List each live company's filings (free — PSX's public announcements
 *      feed, no AI involved)
 *   2. Identify the latest interim report and latest annual report
 *   3. Download both PDFs to .cache/filings/{ticker}/
 *   4. Record a manifest: what exists, what's missing, file sizes, fetch date
 *
 * Extraction (phase 2) then reads from this cache instead of the network:
 * restarting a prompt fix costs nothing beyond re-running the vision calls,
 * and the coverage question — how many companies can even be verified? — is
 * answered before spending anything.
 *
 * Resumable: re-running skips tickers already in the manifest with both
 * files present. Use --refresh to force re-checking specific tickers.
 *
 *   npx tsx scripts/build-filings-inventory.ts                        # full universe
 *   npx tsx scripts/build-filings-inventory.ts --sector "Commercial Banks"
 *   npx tsx scripts/build-filings-inventory.ts --tickers BAFL,JSBL,BAHL
 *   npx tsx scripts/build-filings-inventory.ts --limit 20              # sample
 *   npx tsx scripts/build-filings-inventory.ts --refresh NATF,PTC
 *
 * Sector-by-sector is the recommended way to run this on a disk with limited
 * headroom: a sector is a few dozen companies at most (a hundred or so MB of
 * PDFs), so the risk of filling the disk mid-run is bounded and visible,
 * versus committing to the full ~474-company universe in one pass.
 */
import { loadEnvLocal } from "./load-env";
import { mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

loadEnvLocal();

const CACHE_DIR = ".cache/filings";
const MANIFEST = "data/filings-inventory.json";
const CONCURRENCY = 8;

const arg = (n: string): string | null => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};

// Reject unknown flags instead of ignoring them. A typo or a flag that only
// exists on a sibling script (--from-file lives on backfill-deep-extraction,
// not here) used to be silently dropped, which quietly widened the run to the
// ENTIRE universe. That happened: a 12-ticker request downloaded 471
// companies, filled the disk, and left 376 tickers falsely marked as having
// no filings. Failing loudly on an unrecognised flag is the whole fix.
const KNOWN_FLAGS = new Set(["limit", "refresh", "sector", "tickers", "from-file"]);
for (const a of process.argv.slice(2)) {
  if (!a.startsWith("--")) continue;
  const name = a.slice(2).split("=")[0];
  if (!KNOWN_FLAGS.has(name)) {
    console.error(`unknown flag --${name}. Known flags: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(", ")}`);
    process.exit(1);
  }
}
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const REFRESH = new Set((arg("refresh") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
const SECTOR = arg("sector");
const FROM_FILE = arg("from-file");
const ONLY_TICKERS = new Set(
  [
    ...(arg("tickers") ?? "").split(","),
    // --from-file takes a newline-delimited ticker list, which is easier to
    // review than a long comma string when the batch is more than a handful.
    ...(FROM_FILE ? readFileSync(FROM_FILE, "utf8").split("\n") : []),
  ]
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);
if (FROM_FILE && ONLY_TICKERS.size === 0) {
  console.error(`--from-file ${FROM_FILE} yielded no tickers. Refusing to fall through to the whole universe.`);
  process.exit(1);
}

// Set once the disk guard trips, to stop the ENTIRE run rather than let each
// company catch its own download failure and get recorded as "no filings
// found". Without this the run completes "successfully" while writing a
// manifest that says hundreds of companies have nothing — indistinguishable
// from a genuine absence, and it silently poisons every downstream decision.
let diskExhausted = false;

type Entry = {
  ticker: string;
  interim: { title: string; date: string | null; url: string; path: string; bytes: number } | null;
  annual: { title: string; date: string | null; url: string; path: string; bytes: number } | null;
  checkedAt: string;
  error?: string;
};

function loadManifest(): Record<string, Entry> {
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8")).entries ?? {};
  } catch {
    return {};
  }
}

function saveManifest(entries: Record<string, Entry>) {
  const values = Object.values(entries);
  writeFileSync(
    MANIFEST,
    JSON.stringify(
      {
        _note:
          "Filing inventory for the extraction cache. 'interim'/'annual' point at the latest report of each kind that was found and downloaded to .cache/filings/. A null value means none was found on PSX's public feed as of checkedAt — re-run with --refresh TICKER to re-check.",
        _asOf: new Date().toISOString(),
        summary: {
          total: values.length,
          bothFilings: values.filter((e) => e.interim && e.annual).length,
          interimOnly: values.filter((e) => e.interim && !e.annual).length,
          annualOnly: values.filter((e) => !e.interim && e.annual).length,
          neither: values.filter((e) => !e.interim && !e.annual).length,
        },
        entries,
      },
      null,
      2
    ) + "\n"
  );
}

/** Bail out before a write rather than after — ENOSPC mid-write can leave a
 * truncated PDF on disk that later looks like a successful download. */
function checkDiskHeadroom() {
  try {
    const s = statfsSync(".");
    const freeBytes = s.bavail * s.bsize;
    if (freeBytes < 200 * 1024 * 1024) {
      diskExhausted = true;
      throw new Error(`only ${(freeBytes / 1024 / 1024).toFixed(0)}MB free on disk — stopping before it fills. Free some space and re-run; already-cached files are untouched.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("MB free")) throw e;
    // statfsSync unsupported on this platform: proceed without the guard.
  }
}

async function downloadPdf(url: string, path: string): Promise<number> {
  checkDiskHeadroom();
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://dps.psx.com.pk/" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // The URL can 200 with an HTML error/landing page instead of the document
  // (a broken or expired PSX document link). Writing that blindly produces a
  // cache file that LOOKS present but silently sends garbage to vision later
  // — HUMNL's "annual.pdf" was PSX's homepage HTML, and vision correctly
  // returned nothing usable, but nothing here said why.
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error(`response is not a PDF (got ${buf.subarray(0, 20).toString("latin1").replace(/[^\x20-\x7e]/g, "?")})`);
  }
  // Checking only the HEADER lets a TRUNCATED download through: the first
  // bytes are a valid %PDF- signature, so the file looks fine, but the tail
  // is missing or null-padded and there is no trailer. MSOT's 24.6MB
  // annual.pdf arrived exactly this way — lenient readers coped, a stricter
  // parser would simply fail, and nothing in the manifest said anything was
  // wrong. A PDF must end with %%EOF (allowing for trailing whitespace), so
  // check the tail too and fail loudly rather than caching a broken file.
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString("latin1");
  if (!tail.includes("%%EOF")) {
    throw new Error(`truncated PDF: ${(buf.length / 1e6).toFixed(1)}MB with no %%EOF trailer — download incomplete, not caching`);
  }
  writeFileSync(path, buf);
  return buf.length;
}

async function processTicker(ticker: string): Promise<Entry> {
  const { getCompanyFilings } = await import("@/lib/company/filings");
  const dir = join(CACHE_DIR, ticker);
  mkdirSync(dir, { recursive: true });

  try {
    // "Shariah disclosure" filings often contain "half yearly accounts" or
    // similar in their own title (they are literally about the accounts,
    // just not primary ones) and can share a filing date with the real
    // report — MUGHAL's "Submission of revised Shariah disclosure (Half
    // yearly accounts - December 31, 2025)" out-competed the actual
    // "Transmission of Quarterly Report" filed the same day, and its content
    // is three pages of compliance boilerplate with no income statement at
    // all. Exclude anything with "shariah" in the title outright.
    //
    // The same trap has a second mouth: announcements ABOUT the accounts also
    // match on period wording. AABS's "Advertisement regarding Credit of
    // Interim Dividend for the half year ended March 31, 2026" matched via
    // "half year", was newer than the real "Transmission of Quarterly Report"
    // filed three weeks earlier, and so won the interim slot — leaving a
    // one-page newspaper dividend notice standing in for a set of financial
    // statements. Anything that is a notice, advertisement, intimation,
    // briefing or board-meeting note is excluded regardless of period wording.
    const isReport = (f: { title: string }) =>
      /transmission|quarterly report|half[\s-]?year|annual report|annual account|annual financial statement|condensed interim/i.test(f.title) &&
      !/revoked|withdrawn|cancell?ed|shariah/i.test(f.title) &&
      !/advertisement|intimation|notice|credit of|board meeting|video recording|presentation|briefing|unclaim|un-?paid/i.test(f.title);

    // "Annual Financial Statements" is a THIRD spelling of the same document
    // and was missing here. ENGROH files under it, so the matcher fell through
    // to the FY2024 report and the manifest looked like the FY2025 annual did
    // not exist — when it had been filed on 7 April 2026. A stale-by-a-year
    // annual is far more dangerous than a missing one: it reconciles against
    // nothing but looks like perfectly good data.
    const isAnnual = (f: { title: string }) => /annual report|annual account|annual financial statement/i.test(f.title);

    let all = (await getCompanyFilings(ticker, 40)).filter(isReport);
    // Operationally newsy companies push the annual report past the most
    // recent 40 announcements (director disclosures, notices). Widen only
    // when nothing carrying an annual-report spelling turns up, so quiet
    // companies still pay the cheap 40-item fetch. Same escalation
    // extractFinancials() already uses.
    if (!all.some(isAnnual)) {
      all = (await getCompanyFilings(ticker, 200)).filter(isReport);
    }
    const annualFiling = all.find(isAnnual);
    const interimFiling = all.find((f) => !isAnnual(f));

    const entry: Entry = { ticker, interim: null, annual: null, checkedAt: new Date().toISOString() };
    const errors: string[] = [];

    // Each file downloaded independently: a broken annual-report link must
    // not discard an interim that downloaded fine. The original version
    // wrapped both in one try/catch, so a bad URL for either file threw the
    // whole ticker back to `catch` below, which built a FRESH entry with
    // both fields null — silently erasing a file that had already succeeded.
    if (interimFiling) {
      try {
        const path = join(dir, "interim.pdf");
        const bytes = await downloadPdf(interimFiling.url, path);
        entry.interim = { title: interimFiling.title, date: interimFiling.date, url: interimFiling.url, path, bytes };
      } catch (e) {
        errors.push(`interim: ${(e as Error).message.slice(0, 100)}`);
      }
    }
    if (annualFiling) {
      try {
        const path = join(dir, "annual.pdf");
        const bytes = await downloadPdf(annualFiling.url, path);
        entry.annual = { title: annualFiling.title, date: annualFiling.date, url: annualFiling.url, path, bytes };
      } catch (e) {
        errors.push(`annual: ${(e as Error).message.slice(0, 100)}`);
      }
    }
    if (errors.length) entry.error = errors.join("; ");
    return entry;
  } catch (e) {
    return { ticker, interim: null, annual: null, checkedAt: new Date().toISOString(), error: (e as Error).message.slice(0, 150) };
  }
}

async function main() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { activeUniverseTickers } = await import("@/lib/engine/universe");
  const db = createAdminClient();

  mkdirSync(CACHE_DIR, { recursive: true });
  let live = await activeUniverseTickers(db, "companies");

  if (SECTOR) {
    const page = async <T,>(t: string, c: string): Promise<T[]> => {
      const o: T[] = [];
      for (let i = 0; ; i += 1000) {
        const { data } = await db.from(t).select(c).range(i, i + 999);
        if (!data?.length) break;
        o.push(...(data as unknown as T[]));
        if (data.length < 1000) break;
      }
      return o;
    };
    const sm = await page<{ ticker: string; sector: string | null }>("stock_master", "ticker,sector");
    const inSector = new Set(sm.filter((r) => r.sector === SECTOR).map((r) => r.ticker));
    live = live.filter((t) => inSector.has(t));
    if (live.length === 0) {
      console.log(`no live companies found in sector "${SECTOR}" — check the exact spelling against stock_master.sector`);
      return;
    }
  }
  if (ONLY_TICKERS.size) live = live.filter((t) => ONLY_TICKERS.has(t));
  // --refresh forces re-checking of specific tickers; it must not also widen
  // scope to the whole universe when neither --sector nor --tickers is given.
  // Without this, `--refresh A,B,C` alone processed all 473 companies (since
  // REFRESH only affects needsWork(), not which tickers are in scope at all,
  // and every company not yet inventoried also satisfies needsWork()) —
  // downloaded ~1.5GB for 80 unintended companies before being caught.
  else if (REFRESH.size) live = live.filter((t) => REFRESH.has(t));

  const manifest = loadManifest();

  const needsWork = (t: string): boolean => {
    if (REFRESH.has(t)) return true;
    const e = manifest[t];
    return !e || (!e.interim && !e.annual && !e.error);
  };
  const todo = live.filter(needsWork).slice(0, LIMIT);

  console.log(
    `${SECTOR ? `sector "${SECTOR}": ` : ""}${live.length} companies in scope; ${live.length - todo.length} already inventoried; ${todo.length} to process\n`
  );
  if (todo.length === 0) {
    console.log("nothing to do — everything already inventoried. Use --refresh TICKER1,TICKER2 to force a re-check.");
    printSummary(manifest);
    return;
  }

  let done = 0;
  const startedAt = Date.now();
  // Simple concurrency pool: fixed-size set of in-flight promises.
  const queue = [...todo];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      // Stop the whole run the moment the disk guard trips. Previously each
      // ticker caught its own download failure and was recorded with both
      // files null, so an out-of-space run finished "successfully" while
      // writing a manifest that claimed hundreds of companies had no filings.
      if (diskExhausted) break;
      const t = queue.shift();
      if (!t) break;
      const entry = manifest[t]?.error && !manifest[t]?.interim && !manifest[t]?.annual ? await processTicker(t) : await processTicker(t);
      manifest[t] = entry;
      done++;
      if (done % 10 === 0 || done === todo.length) {
        saveManifest(manifest);
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`  ${done}/${todo.length} (${elapsed}s) latest: ${t} interim=${!!entry.interim} annual=${!!entry.annual}${entry.error ? ` ERROR:${entry.error}` : ""}`);
      }
    }
  });
  await Promise.all(workers);
  saveManifest(manifest);

  if (diskExhausted) {
    console.error(`\nSTOPPED: disk ran out of headroom after ${done}/${todo.length} tickers.`);
    console.error(`The ${todo.length - done} unprocessed tickers are NOT recorded as "no filings" — they were simply never attempted.`);
    console.error(`Free space and re-run; cached files are untouched and already-done tickers are skipped.`);
    process.exit(1);
  }

  console.log(`\ndone in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  printSummary(manifest);
}

function printSummary(manifest: Record<string, Entry>) {
  const values = Object.values(manifest);
  const both = values.filter((e) => e.interim && e.annual);
  const interimOnly = values.filter((e) => e.interim && !e.annual);
  const annualOnly = values.filter((e) => !e.interim && e.annual);
  const neither = values.filter((e) => !e.interim && !e.annual);
  console.log(`\nCOVERAGE (${values.length} companies inventoried)`);
  console.log(`  both interim + annual (full TTM readable): ${both.length}`);
  console.log(`  interim only (no annual report found):     ${interimOnly.length}`);
  console.log(`  annual only (no recent interim):           ${annualOnly.length}`);
  console.log(`  neither (nothing readable):                ${neither.length}`);
  if (neither.length) console.log(`\n  companies with nothing: ${neither.map((e) => e.ticker).join(", ")}`);
  console.log(`\nwritten: ${MANIFEST}`);
  console.log(`cached PDFs under: ${CACHE_DIR}/`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
