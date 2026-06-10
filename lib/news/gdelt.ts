import type { DiscoveredNewsArticle, NewsHolding } from "@/lib/news/types";

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_DELAY_MS = 5500;

type GdeltArticle = {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

export function gdeltConfigured(): boolean {
  return process.env.NEWS_ENABLE_GDELT !== "false";
}

export async function gdeltSearchHoldings(
  holdings: NewsHolding[],
  opts: { days?: number; maxResultsPerHolding?: number } = {}
): Promise<{ articles: DiscoveredNewsArticle[]; errors: string[] }> {
  if (!gdeltConfigured()) return { articles: [], errors: [] };

  const days = opts.days ?? 7;
  const maxResults = opts.maxResultsPerHolding ?? 2;
  const delayMs = Number(process.env.GDELT_REQUEST_DELAY_MS ?? DEFAULT_DELAY_MS);
  const articles: DiscoveredNewsArticle[] = [];
  const errors: string[] = [];

  for (let i = 0; i < holdings.length; i++) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const holding = holdings[i];
    try {
      const results = await gdeltSearch(buildQuery(holding), { days, maxResults });
      for (const r of results) {
        const url = r.url_mobile || r.url;
        if (!url || !r.title) continue;
        articles.push({
          url,
          title: r.title,
          snippet: r.title,
          ticker: holding.ticker,
          company_name: holding.company_name ?? holding.ticker,
          sector: holding.sector,
          source: r.domain ?? safeHostname(url),
          published_at: parseGdeltDate(r.seendate),
          provider: "gdelt",
          category: "general",
          source_quality: "unknown",
          link_reason: `GDELT matched the company name for ${holding.ticker}.`,
        });
      }
    } catch (err) {
      errors.push(`${holding.ticker} GDELT: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { articles, errors };
}

async function gdeltSearch(
  query: string,
  opts: { days: number; maxResults: number }
): Promise<GdeltArticle[]> {
  const url = new URL(GDELT_DOC_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("maxrecords", String(opts.maxResults));
  url.searchParams.set("timespan", `${Math.max(1, opts.days * 24)}H`);

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  if (text.startsWith("Please limit requests")) throw new Error(text.slice(0, 160));

  const data = JSON.parse(text) as GdeltResponse;
  return data.articles ?? [];
}

function buildQuery(holding: NewsHolding): string {
  const company = holding.company_name?.replace(/\s+/g, " ").trim();
  if (company) return `"${company}"`;
  return `"${holding.ticker}" Pakistan Stock Exchange`;
}

function parseGdeltDate(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(
    /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/,
    "$1-$2-$3T$4:$5:$6Z"
  );
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "gdelt";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
