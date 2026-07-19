/**
 * Import the scraped Sarmaaya snapshot directory into data/sarmaaya-snapshots.json.
 *
 * Source: sarmaya/stocks/{TICKER}.json, one file per company, each holding the
 * Company Snapshot panel as printed on sarmaaya.pk.
 *
 * Existing hand-curated entries are preserved. Where an entry already carries
 * a "note" or "basis" recorded from an earlier investigation (the consolidated
 * cases, the micro-caps whose earnings cross zero), those fields survive the
 * import — they are conclusions we reached, not data we scraped, and they
 * would be expensive to rediscover.
 *
 *   npx tsx scripts/import-sarmaaya-snapshots.ts
 */
import { loadEnvLocal } from "./load-env";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

loadEnvLocal();

const DIR = "sarmaya/stocks";
const OUT = "data/sarmaaya-snapshots.json";

/** "93.11B" -> 93110000000, "97.9M" -> 97900000, "1.3K" -> 1300, "-" -> null. */
function parseNum(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s || s === "-" || s.toLowerCase() === "n/a") return null;
  const m = s.match(/^(-?\d*\.?\d+)([KMB])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase() as "K" | "M" | "B"] : 1;
  return n * mult;
}

type Snapshot = Record<string, unknown>;

function main() {
  const existing = JSON.parse(readFileSync(OUT, "utf8")) as {
    _note: string;
    _asOf: string;
    snapshots: Record<string, Snapshot>;
  };

  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  let imported = 0;
  let withEps = 0;
  let preserved = 0;
  let scrapedAt = "";

  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(DIR, f), "utf8")) as {
      symbol?: string;
      name?: string;
      scraped_at?: string;
      snapshot?: Record<string, string>;
    };
    const ticker = (raw.symbol ?? f.replace(/\.json$/, "")).toUpperCase();
    const s = raw.snapshot ?? {};
    if (raw.scraped_at && raw.scraped_at > scrapedAt) scrapedAt = raw.scraped_at;

    const next: Snapshot = {
      name: raw.name ?? undefined,
      priceClose: parseNum(s["Price close"]),
      high52: parseNum(s["52 week high price"]),
      low52: parseNum(s["52 week low price"]),
      marketCap: parseNum(s["Market cap"]),
      shares: parseNum(s["Shares outstanding"]),
      freeFloatPct: parseNum(s["Free Float %"]),
      dividendYield: parseNum(s["Dividend Yield (%)"]),
      eps: parseNum(s["Earnings Per Share"]),
      netMargin: parseNum(s["Net Income Margin (%)"]),
      pb: parseNum(s["Price to Book Value"]),
      pe: parseNum(s["Price to Earnings"]),
      peg: parseNum(s["PEG Ratio"]),
    };
    for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined) delete next[k];
    if (next.eps !== undefined) withEps++;

    // Conclusions recorded earlier are ours, not Sarmaaya's — keep them.
    const prior = existing.snapshots[ticker];
    if (prior?.basis) {
      next.basis = prior.basis;
      preserved++;
    }
    if (prior?.note) {
      next.note = prior.note;
      preserved++;
    }

    existing.snapshots[ticker] = next;
    imported++;
  }

  existing._asOf = scrapedAt.slice(0, 10) || existing._asOf;
  existing._note =
    "Sarmaaya Company Snapshot reference data. Bulk-imported from sarmaya/stocks/{TICKER}.json via scripts/import-sarmaaya-snapshots.ts; earlier entries were pasted by hand. Used to validate our ratio engine. basis='consolidated' marks names where Sarmaaya reports the group (we compute unconsolidated to match PSX), so an EPS/PE gap there is expected, not a bug. 'note' records a conclusion we reached, not scraped data.";

  writeFileSync(OUT, JSON.stringify(existing, null, 2) + "\n");

  console.log(`imported ${imported} snapshots (${withEps} carry an EPS)`);
  console.log(`preserved ${preserved} basis/note fields from earlier investigations`);
  console.log(`store now holds ${Object.keys(existing.snapshots).length} companies, as of ${existing._asOf}`);
}

main();
