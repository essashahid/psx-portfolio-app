import type { DiscoveredNewsArticle, NewsCategory, NewsHolding } from "@/lib/news/types";

const BASE_URL = "https://dps.psx.com.pk";
const REQUEST_TIMEOUT_MS = 12_000;
/** The portal's own per-response ceiling; asking for more returns 100 anyway. */
const PAGE_SIZE = 100;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html, */*; q=0.01",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://dps.psx.com.pk/announcements/companies",
};

export type PsxAnnouncement = {
  date: string;
  time: string;
  ticker: string;
  companyName: string;
  title: string;
  url: string;
};

/** Raw company announcements for one ticker (newest first). Reused by the dividend engine. */
export async function getCompanyAnnouncements(ticker: string, count: number): Promise<PsxAnnouncement[]> {
  return fetchCompanyAnnouncements(ticker, count);
}

/**
 * The full announcement archive for one ticker, newest first, walked page by
 * page.
 *
 * The portal caps a single response at 100 rows however large `count` is, so
 * every caller asking for more than that silently got the most recent 100 and
 * no indication there was more. For a busy filer that is barely eighteen
 * months: OGDC's 100th row is Feb 2025, which put its own FY2022 accounts out
 * of reach of the extractor while the portal was in fact still serving them.
 * The endpoint does honour `offset`, so paging reaches back to 2014.
 *
 * Pages are fetched in sequence, not in parallel, because this walks a public
 * portal that nothing obliges to serve us.
 */
export async function getCompanyAnnouncementArchive(
  ticker: string,
  opts: { maxPages?: number; notBefore?: Date } = {}
): Promise<PsxAnnouncement[]> {
  const maxPages = opts.maxPages ?? 20;
  const symbol = ticker.toUpperCase();
  const out: PsxAnnouncement[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchCompanyAnnouncements(symbol, PAGE_SIZE, page * PAGE_SIZE);
    if (rows.length === 0) break;

    // Pages overlap by one row at these offsets, and a portal that ignored
    // `offset` would hand back the same page forever. Stopping on "this page
    // added nothing new" covers both without assuming which.
    let added = 0;
    for (const row of rows) {
      const key = `${row.date}|${row.time}|${row.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      added++;
    }
    if (added === 0) break;

    if (opts.notBefore) {
      const oldest = parsePsxDateTime(rows[rows.length - 1].date, rows[rows.length - 1].time);
      if (oldest && new Date(oldest) < opts.notBefore) break;
    }
  }

  return out;
}

export function psxAnnouncementsConfigured(): boolean {
  return process.env.NEWS_ENABLE_PSX_ANNOUNCEMENTS !== "false";
}

export async function psxAnnouncementSearchHoldings(
  holdings: NewsHolding[],
  opts: { maxResultsPerHolding?: number } = {}
): Promise<{ articles: DiscoveredNewsArticle[]; errors: string[] }> {
  if (!psxAnnouncementsConfigured()) return { articles: [], errors: [] };

  const maxResults = opts.maxResultsPerHolding ?? 4;
  const articles: DiscoveredNewsArticle[] = [];
  const errors: string[] = [];

  for (const holding of holdings) {
    try {
      const rows = await fetchCompanyAnnouncements(holding.ticker, maxResults);
      for (const row of rows) {
        const { category, material } = classifyAnnouncement(row.title);
        // Material filings (results, dividends, big business events) lead the
        // feed; routine governance/admin filings (director change, treasury
        // shares, book closure, AGM notices) are kept but pushed down so they
        // stop drowning out genuinely useful news.
        const relevance = material ? (category === "result" || category === "dividend" ? 10 : 8) : 3;
        articles.push({
          url: row.url,
          title: row.title,
          snippet: `${row.companyName || holding.ticker} filed a PSX company announcement: ${row.title}.`,
          ticker: holding.ticker,
          company_name: row.companyName || holding.company_name || holding.ticker,
          sector: holding.sector,
          source: "PSX Filing",
          published_at: parsePsxDateTime(row.date, row.time),
          provider: "psx-announcements",
          scope: "portfolio",
          category,
          sentiment: "neutral",
          relevance_score: relevance,
          ai_summary: `${row.companyName || holding.ticker} filed a PSX company announcement: ${row.title}.`,
          why_it_matters: material
            ? "Official company filing on the PSX portal for a portfolio holding."
            : "Routine administrative filing — low investment signal.",
          source_quality: "high",
          link_reason: `Official PSX company announcement for ${holding.ticker}.`,
          low_confidence: !material,
        });
      }
    } catch (err) {
      errors.push(`${holding.ticker} PSX announcements: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { articles, errors };
}

async function fetchCompanyAnnouncements(ticker: string, count: number, offset = 0): Promise<PsxAnnouncement[]> {
  const body = new URLSearchParams({
    type: "C",
    symbol: ticker,
    query: "",
    count: String(count),
    offset: String(offset),
    date_from: "",
    date_to: "",
  });

  const res = await fetch(`${BASE_URL}/announcements`, {
    method: "POST",
    headers: BROWSER_HEADERS,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  }

  return parseAnnouncementRows(await res.text()).filter((row) => row.ticker === ticker);
}

function parseAnnouncementRows(html: string): PsxAnnouncement[] {
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  return rows
    .map((row) => {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripHtml(m[1]));
      if (cells.length < 5) return null;
      const pdf = row.match(/href="([^"]*\/download\/document\/[^"]+\.pdf)"/i)?.[1];
      const image = row.match(/data-images="([^"]+)"/i)?.[1];
      const url = pdf
        ? absoluteUrl(pdf)
        : image
          ? absoluteUrl(`/download/image/${image}`)
          : "https://dps.psx.com.pk/announcements/companies";

      return {
        date: cells[0],
        time: cells[1],
        ticker: cells[2].toUpperCase(),
        companyName: cells[3],
        title: cells[4],
        url,
      };
    })
    .filter((row): row is PsxAnnouncement => !!row);
}

/**
 * Classify a filing and decide whether it is material (leads the feed) or
 * routine boilerplate (director change, treasury shares, book closure, AGM
 * notices, pattern of shareholding) that should be pushed down.
 */
function classifyAnnouncement(title: string): { category: NewsCategory; material: boolean } {
  const t = title.toLowerCase();
  if (/\b(dividend|bonus|right issue|entitlement|payout|cash dividend|interim dividend)\b/.test(t)) {
    return { category: "dividend", material: true };
  }
  if (/\b(financial result|quarterly report|annual report|accounts|earnings|profit|eps)\b/.test(t)) {
    return { category: "result", material: true };
  }
  // Genuinely market-moving corporate events.
  if (/\b(acquisition|merger|expansion|plant|capacity|investment|contract|agreement|exploration|discovery|production|capex|de-?merger|spin-?off|de-?listing|material information)\b/.test(t)) {
    return { category: "corporate_announcement", material: true };
  }
  // Routine governance / administrative boilerplate.
  return { category: "corporate_announcement", material: false };
}

function parsePsxDateTime(dateValue: string, timeValue: string): string | null {
  const date = new Date(`${dateValue} ${timeValue} GMT+0500`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${BASE_URL}${path}`;
}
