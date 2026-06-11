/**
 * Structured company fundamentals from the official PSX Data Portal company
 * page (dps.psx.com.pk/company/{SYMBOL}).
 *
 * The page embeds clean, structured tables — annual & quarterly Sales/EPS, the
 * official ratio set (margins, EPS growth, PEG), the P/E (TTM), and the equity
 * profile (market cap, shares, free float). We parse these deterministically:
 * ONE HTTP request per company, no PDF download, no LLM, no per-document cost.
 * Every number is read literally from PSX — nothing is invented or estimated.
 */

const COMPANY_BASE = "https://dps.psx.com.pk/company";
const REQUEST_TIMEOUT_MS = 12_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "*/*",
  Referer: "https://dps.psx.com.pk/",
};

/** A period column of reported figures (Sales in PKR thousands, EPS in PKR). */
export interface PsxPeriodFigures {
  /** Column header, e.g. "2025" (annual) or "Q3 2026" (quarter). */
  label: string;
  /** Fiscal year the column belongs to. */
  fiscalYear: number | null;
  /** "FY" for annual columns, "Q1".."Q4" for quarter columns. */
  fiscalPeriod: string | null;
  /** Net sales / revenue, in PKR thousands (as reported by PSX). */
  sales: number | null;
  /** Earnings per share, in PKR. */
  eps: number | null;
  /** Gross profit margin %, when present in the ratios table. */
  grossMarginPct: number | null;
  /** Net profit margin %, when present in the ratios table. */
  netMarginPct: number | null;
  /** EPS growth %, when present in the ratios table. */
  epsGrowthPct: number | null;
}

export interface PsxCompanyData {
  ticker: string;
  sourceUrl: string;
  annual: PsxPeriodFigures[];
  quarterly: PsxPeriodFigures[];
  /** Trailing-twelve-month P/E ratio as published by PSX. */
  peTtm: number | null;
  /** Shares outstanding (actual count, not thousands). */
  shares: number | null;
  /** Free float (actual share count). */
  freeFloat: number | null;
  /** Market capitalization in full PKR (page reports it in thousands). */
  marketCap: number | null;
}

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a PSX-formatted number: "56,135,421" → 56135421, "(45.77)" → -45.77. */
function parseNum(raw: string): number | null {
  if (!raw) return null;
  const neg = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[(),%\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/** Split a column header into fiscal year + period. "2025" → FY; "Q3 2026" → Q3. */
function parseHeader(h: string): { fiscalYear: number | null; fiscalPeriod: string | null } {
  const q = h.match(/^Q([1-4])\s+(\d{4})$/i);
  if (q) return { fiscalYear: Number(q[2]), fiscalPeriod: `Q${q[1]}` };
  const y = h.match(/(\d{4})/);
  return { fiscalYear: y ? Number(y[1]) : null, fiscalPeriod: y ? "FY" : null };
}

function tableRows(tableHtml: string): string[][] {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((tr) =>
    [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => clean(c[1]))
  );
}

/** Build the per-column figures for a financials table (Sales + EPS rows). */
function buildColumns(rows: string[][]): PsxPeriodFigures[] {
  const header = rows[0] ?? [];
  // first cell is the row-label column; the rest are period headers
  const periods = header.slice(1).map((h) => ({ label: h, ...parseHeader(h) }));
  const cols: PsxPeriodFigures[] = periods.map((p) => ({
    label: p.label,
    fiscalYear: p.fiscalYear,
    fiscalPeriod: p.fiscalPeriod,
    sales: null,
    eps: null,
    grossMarginPct: null,
    netMarginPct: null,
    epsGrowthPct: null,
  }));
  for (const row of rows.slice(1)) {
    const label = (row[0] ?? "").toLowerCase();
    const values = row.slice(1).map(parseNum);
    const assign = (key: keyof PsxPeriodFigures) =>
      values.forEach((v, i) => {
        if (cols[i]) (cols[i][key] as number | null) = v;
      });
    if (label.includes("sales")) assign("sales");
    else if (label === "eps" || label.includes("earnings per share")) assign("eps");
  }
  return cols;
}

/** Merge the ratios table (margins / EPS growth) onto matching annual columns. */
function mergeRatios(annual: PsxPeriodFigures[], rows: string[][]): void {
  const header = rows[0] ?? [];
  const periods = header.slice(1).map((h) => parseHeader(h).fiscalYear);
  for (const row of rows.slice(1)) {
    const label = (row[0] ?? "").toLowerCase();
    const values = row.slice(1).map(parseNum);
    let key: keyof PsxPeriodFigures | null = null;
    if (label.includes("gross profit margin")) key = "grossMarginPct";
    else if (label.includes("net profit margin")) key = "netMarginPct";
    else if (label.includes("eps growth")) key = "epsGrowthPct";
    if (!key) continue;
    periods.forEach((year, i) => {
      const col = annual.find((c) => c.fiscalYear === year && c.fiscalPeriod === "FY");
      if (col && values[i] != null) (col[key!] as number | null) = values[i];
    });
  }
}

function classify(rows: string[][]): "financials" | "ratios" | "other" {
  const labels = rows.map((r) => (r[0] ?? "").toLowerCase());
  if (labels.some((l) => l.includes("profit margin") || l.includes("eps growth"))) return "ratios";
  if (labels.some((l) => l.includes("sales")) && labels.some((l) => l === "eps" || l.includes("earnings per share")))
    return "financials";
  return "other";
}

/**
 * Fetch and parse the PSX company page. Returns null when the page is
 * unreachable or contains no recognizable financial tables.
 */
export async function fetchPsxCompanyData(ticker: string): Promise<PsxCompanyData | null> {
  const symbol = ticker.toUpperCase();
  const sourceUrl = `${COMPANY_BASE}/${encodeURIComponent(symbol)}`;
  let html: string;
  try {
    const res = await fetch(sourceUrl, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => tableRows(m[0]));

  let annual: PsxPeriodFigures[] = [];
  let quarterly: PsxPeriodFigures[] = [];
  let ratioRows: string[][] | null = null;

  for (const rows of tables) {
    const kind = classify(rows);
    if (kind === "financials") {
      const isQuarterly = /^Q[1-4]\s/i.test(rows[0]?.[1] ?? "");
      const cols = buildColumns(rows);
      if (isQuarterly) quarterly = cols;
      else annual = cols;
    } else if (kind === "ratios" && !ratioRows) {
      ratioRows = rows;
    }
  }

  if (ratioRows && annual.length) mergeRatios(annual, ratioRows);

  // Equity profile + P/E (TTM) live outside the tables, as labeled spans.
  const sharesM = html.match(/Shares[\s\S]{0,120}?([\d,]+)\s*<\/(?:div|td|span)/i) || html.match(/Shares<\/[^>]+>\s*<[^>]+>\s*([\d,]+)/i);
  const marketCapM = html.match(/Market Cap[^<]*\(?\s*000['’]?s?\s*\)?[\s\S]{0,160}?([\d,]+(?:\.\d+)?)/i);
  const freeFloatM = html.match(/Free Float[\s\S]{0,120}?([\d,]+)(?!\s*%)/i);
  const peM = html.match(/P\/E Ratio \(TTM\)[\s\S]{0,200}?([\d,]+\.\d+)/i);

  const shares = sharesM ? parseNum(sharesM[1]) : null;
  const marketCapThousands = marketCapM ? parseNum(marketCapM[1]) : null;

  if (!annual.length && !quarterly.length) return null;

  return {
    ticker: symbol,
    sourceUrl,
    annual,
    quarterly,
    peTtm: peM ? parseNum(peM[1]) : null,
    shares,
    freeFloat: freeFloatM ? parseNum(freeFloatM[1]) : null,
    marketCap: marketCapThousands != null ? marketCapThousands * 1000 : null,
  };
}
