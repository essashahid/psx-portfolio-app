import { loadEnvLocal } from "./load-env";
import { writeFileSync, rmSync, readdirSync } from "node:fs";

/**
 * Prep a ticker's latest result filing for in-session reading: find the best
 * recent report PDF, download it, split into page-range chunks, and write them
 * to the scratchpad so Claude can Read the statement pages and transcribe them
 * through saveManualStatements. Support tool for the manual gold-label pass; no
 * LLM/API call here.
 *
 *   npx tsx scripts/prep-filing-chunks.ts <TICKER> [--interim|--annual] [--pages N] [--doc <id>]
 */

const SCRATCH = "/private/tmp/claude-501/-Users-essaarshad-Downloads-psx-portfolio-app/e9ed7223-9ad4-4958-bb0f-de06f255a8ae/scratchpad";

async function main() {
  loadEnvLocal();
  const { getCompanyFilings } = await import("@/lib/company/filings");
  const { splitPdfPages, pdfPageCount } = await import("@/lib/engine/pdf-chunks");

  const args = process.argv.slice(2);
  const ticker = args[0]?.toUpperCase();
  if (!ticker) { console.error("usage: prep-filing-chunks.ts <TICKER> [--interim|--annual] [--pages N] [--doc <id>]"); process.exit(1); }
  const wantAnnual = args.includes("--annual");
  const pagesArg = args.indexOf("--pages");
  const pagesPerChunk = pagesArg >= 0 ? Number(args[pagesArg + 1]) : 8;
  const docArg = args.indexOf("--doc");
  const forceDoc = docArg >= 0 ? args[docArg + 1] : null;

  // clear previous chunks for this ticker
  for (const f of readdirSync(SCRATCH)) if (f.startsWith(`${ticker.toLowerCase()}-`) && f.endsWith(".pdf")) rmSync(`${SCRATCH}/${f}`);

  const filings = await getCompanyFilings(ticker, wantAnnual ? 200 : 40);
  const isReport = (title: string): boolean => {
    const x = title.toLowerCase();
    if (/shariah|video|briefing|presentation|clarification|notice of|proxy|agm|egm|book closure|circular|postal ballot|auditor|pattern of shareholding/.test(x)) return false;
    return /transmission|quarterly report|half[\s-]?year|annual report|annual account|financial result|financial statement|accounts for|condensed interim|un-?audited|audited/.test(x);
  };
  const dateMs = (d: string | null) => { const n = d ? Date.parse(d) : NaN; return Number.isFinite(n) ? n : 0; };

  let candidates = filings.filter((f) => f.url.toLowerCase().includes(".pdf") && isReport(f.title));
  if (forceDoc) candidates = candidates.filter((f) => f.url.includes(forceDoc));
  else if (wantAnnual) candidates = candidates.filter((f) => /annual report|annual account/i.test(f.title));
  else candidates = candidates.filter((f) => /transmission|quarterly report|half[\s-]?year|condensed interim/i.test(f.title));
  candidates.sort((a, b) => dateMs(b.date) - dateMs(a.date));

  const chosen = candidates[0];
  if (!chosen) { console.error(`no ${wantAnnual ? "annual" : "interim"} report PDF found for ${ticker}`); process.exit(1); }
  console.log(`ticker: ${ticker}`);
  console.log(`filing: ${chosen.title}`);
  console.log(`date:   ${chosen.date}`);
  console.log(`url:    ${chosen.url}`);

  const res = await fetch(chosen.url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://dps.psx.com.pk/" } });
  const buf = Buffer.from(await res.arrayBuffer());
  const pages = await pdfPageCount(buf);
  console.log(`size:   ${(buf.byteLength / 1e6).toFixed(1)} MB, ${pages} pages\n`);

  const chunks = await splitPdfPages(buf, pagesPerChunk);
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const path = `${SCRATCH}/${ticker.toLowerCase()}-c${i}-p${c.firstPage}_${c.lastPage}.pdf`;
    writeFileSync(path, c.buf);
    console.log(`  ${path}  (${(c.buf.byteLength / 1e6).toFixed(1)} MB)`);
  }
  console.log(`\nRead the chunk covering the condensed statements (usually the first ${pagesPerChunk * 2} pages for an interim).`);
}

main().catch((err) => { console.error(err); process.exit(1); });
