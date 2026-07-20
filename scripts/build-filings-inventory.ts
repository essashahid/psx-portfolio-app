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
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const REFRESH = new Set((arg("refresh") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
const SECTOR = arg("sector");
const ONLY_TICKERS = new Set((arg("tickers") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));

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
  writeFileSync(path, buf);
  return buf.length;
}

async function processTicker(ticker: string): Promise<Entry> {
  const { getCompanyFilings } = await import("@/lib/company/filings");
  const dir = join(CACHE_DIR, ticker);
  mkdirSync(dir, { recursive: true });

  try {
    const isReport = (f: { title: string }) =>
      /transmission|quarterly report|half[\s-]?year|annual report|annual account|condensed interim/i.test(f.title) &&
      !/revoked|withdrawn|cancell?ed/i.test(f.title);
    let all = (await getCompanyFilings(ticker, 40)).filter(isReport);
    // Operationally newsy companies push the annual report past the most
    // recent 40 announcements (director disclosures, notices). Widen only
    // when nothing carrying "annual report/account" turns up, so quiet
    // companies still pay the cheap 40-item fetch. Same escalation
    // extractFinancials() already uses.
    if (!all.some((f) => /annual report|annual account/i.test(f.title))) {
      all = (await getCompanyFilings(ticker, 200)).filter(isReport);
    }
    const annualFiling = all.find((f) => /annual report|annual account/i.test(f.title));
    const interimFiling = all.find((f) => !/annual report|annual account/i.test(f.title));

    const entry: Entry = { ticker, interim: null, annual: null, checkedAt: new Date().toISOString() };

    if (interimFiling) {
      const path = join(dir, "interim.pdf");
      const bytes = await downloadPdf(interimFiling.url, path);
      entry.interim = { title: interimFiling.title, date: interimFiling.date, url: interimFiling.url, path, bytes };
    }
    if (annualFiling) {
      const path = join(dir, "annual.pdf");
      const bytes = await downloadPdf(annualFiling.url, path);
      entry.annual = { title: annualFiling.title, date: annualFiling.date, url: annualFiling.url, path, bytes };
    }
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
