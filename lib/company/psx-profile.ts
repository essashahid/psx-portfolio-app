const COMPANY_BASE = "https://dps.psx.com.pk/company";
const REQUEST_TIMEOUT_MS = 12_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "*/*",
  Referer: "https://dps.psx.com.pk/",
};

export interface PsxCompanyProfile {
  ticker: string;
  sourceUrl: string;
  businessDescription: string;
  website: string | null;
  address: string | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, raw: string) => {
    const key = raw.toLowerCase();
    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[key] ?? entity;
  });
}

function cleanHtml(fragment: string | null | undefined): string | null {
  if (!fragment) return null;
  const text = decodeEntities(
    fragment
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalizeWebsite(href: string | null, label: string | null): string | null {
  const value = (href || label || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

export function parsePsxCompanyProfileHtml(ticker: string, html: string): PsxCompanyProfile | null {
  const symbol = ticker.toUpperCase();
  const sourceUrl = `${COMPANY_BASE}/${encodeURIComponent(symbol)}`;
  const descriptionMatch = html.match(
    /<div[^>]*class=["'][^"']*profile__item--decription[^"']*["'][^>]*>[\s\S]*?<div[^>]*class=["']item__head["'][^>]*>\s*BUSINESS DESCRIPTION\s*<\/div>\s*<p[^>]*>([\s\S]*?)<\/p>/i
  );
  const businessDescription = cleanHtml(descriptionMatch?.[1]);
  if (!businessDescription || businessDescription.length < 20) return null;

  const websiteMatch = html.match(
    /<div[^>]*class=["']item__head["'][^>]*>\s*WEBSITE\s*<\/div>\s*<p[^>]*>\s*(?:<a[^>]*href=["']([^"']+)["'][^>]*>)?([\s\S]*?)(?:<\/a>)?\s*<\/p>/i
  );
  const website = normalizeWebsite(websiteMatch?.[1] ?? null, cleanHtml(websiteMatch?.[2]));

  const addressMatch = html.match(
    /<div[^>]*class=["']item__head["'][^>]*>\s*ADDRESS\s*<\/div>\s*<p[^>]*>([\s\S]*?)<\/p>/i
  );

  return {
    ticker: symbol,
    sourceUrl,
    businessDescription,
    website,
    address: cleanHtml(addressMatch?.[1]),
  };
}

export async function fetchPsxCompanyProfile(ticker: string): Promise<PsxCompanyProfile | null> {
  const symbol = ticker.toUpperCase();
  const sourceUrl = `${COMPANY_BASE}/${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(sourceUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parsePsxCompanyProfileHtml(symbol, await res.text());
  } catch {
    return null;
  }
}
