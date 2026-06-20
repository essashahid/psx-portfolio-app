import type { DiscoveredNewsArticle, NewsCategory, NewsHolding } from "@/lib/news/types";

const BASE_URL = "https://dps.psx.com.pk";
const REQUEST_TIMEOUT_MS = 12_000;

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

async function fetchCompanyAnnouncements(ticker: string, count: number): Promise<PsxAnnouncement[]> {
  const body = new URLSearchParams({
    type: "C",
    symbol: ticker,
    query: "",
    count: String(count),
    offset: "0",
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
