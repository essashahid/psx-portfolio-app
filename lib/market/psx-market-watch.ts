/**
 * Whole-market PSX feeds from the official Data Portal (dps.psx.com.pk).
 *
 *   /market-watch — every traded symbol in ONE request: price, prev close,
 *                   OHLC, change, change%, volume, sector code, company name.
 *   /indices      — KSE100 and the other PSX indices: level, change, change%.
 *
 * This is the foundation of the Market Pulse snapshot: two HTTP requests cover
 * the entire market, so building a snapshot never makes per-ticker calls and
 * never invents a number. Both parsers return [] / null on failure so callers
 * degrade to a clear "data unavailable" state instead of throwing.
 */

const BASE = "https://dps.psx.com.pk";
const REQUEST_TIMEOUT_MS = 15_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "*/*",
  Referer: "https://dps.psx.com.pk/",
};

export interface MarketWatchRow {
  ticker: string;
  companyName: string | null;
  /** Raw PSX sector code from the table (e.g. "0813"); names come from the directory. */
  sectorCode: string | null;
  price: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
}

export interface IndexQuote {
  name: string;
  value: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePercent: number | null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const neg = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[(),%\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

async function fetchHtml(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Parse the full market-watch table. Columns are:
 * SYMBOL | SECTOR | LISTED IN | LDCP | OPEN | HIGH | LOW | CURRENT | CHANGE | CHANGE (%) | VOLUME
 * The symbol cell also carries the full company name in `data-title`.
 */
export async function fetchMarketWatch(): Promise<MarketWatchRow[]> {
  const html = await fetchHtml("/market-watch");
  if (!html) return [];
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];

  const rows: MarketWatchRow[] = [];
  const trMatches = table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
  for (const tr of trMatches) {
    const rowHtml = tr[1];
    const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (tds.length < 11) continue; // header row / malformed
    const symbolCell = tds[0];
    const ticker = stripTags(symbolCell).toUpperCase();
    if (!ticker) continue;
    const titleMatch = symbolCell.match(/data-title="([^"]+)"/);
    rows.push({
      ticker,
      companyName: titleMatch ? titleMatch[1].trim() : null,
      sectorCode: stripTags(tds[1]) || null,
      previousClose: num(stripTags(tds[3])),
      open: num(stripTags(tds[4])),
      high: num(stripTags(tds[5])),
      low: num(stripTags(tds[6])),
      price: num(stripTags(tds[7])),
      change: num(stripTags(tds[8])),
      changePercent: num(stripTags(tds[9])),
      volume: num(stripTags(tds[10])),
    });
  }
  return rows;
}

/** Parse the indices table (KSE100 first). */
export async function fetchIndices(): Promise<IndexQuote[]> {
  const html = await fetchHtml("/indices");
  if (!html) return [];
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!table) return [];
  const out: IndexQuote[] = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => stripTags(m[1]));
    if (cells.length < 6 || /index/i.test(cells[0])) continue; // header
    const name = cells[0];
    if (!name) continue;
    out.push({
      name,
      high: num(cells[1]),
      low: num(cells[2]),
      value: num(cells[3]),
      change: num(cells[4]),
      changePercent: num(cells[5]),
    });
  }
  return out;
}

/** The headline index for the market summary — KSE100 when present. */
export function headlineIndex(indices: IndexQuote[]): IndexQuote | null {
  return indices.find((i) => /^KSE.?100$/i.test(i.name)) ?? indices.find((i) => /^ALLSHR$/i.test(i.name)) ?? indices[0] ?? null;
}
