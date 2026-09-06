import type { CompanyMetadata, Filing, Quote } from "@psx/shared/company/types";
import type { CompanyFiling, CompanyNewsItem, CompanyTrends, QuoteFreshness } from "@psx/shared/api/stocks";
import type { FundamentalsData } from "@/lib/company/fundamentals";
import type { NewsCluster } from "@/lib/news/global-store";

/**
 * Pieces of the company Overview that the web page and the phone endpoint
 * both need, kept here so the two surfaces cannot drift: which description
 * counts as official, which filed years feed the trend bars, how a filing
 * category reads in words, and what a news cluster is attributed to.
 */

/**
 * Whether a stored profile came from the exchange's own company page.
 *
 * Judged on the source URL, not the source label. The label is unreliable:
 * identity.ts stamps "stock-universe" over it whenever it fills in a name or
 * sector, so genuine PSX prose was being suppressed. The URL records where the
 * text actually came from and nothing overwrites it.
 */
export function isOfficialPsxProfileSource(source: string | null | undefined, sourceUrl?: string | null): boolean {
  if (sourceUrl && /dps\.psx\.com\.pk\/company\//i.test(sourceUrl)) return true;
  return source === "psx-company-page" || source === "psx-portal";
}

/**
 * The business description, trimmed only when it is genuinely long.
 *
 * The median PSX description is 316 characters and OGDC's is 405, so the limit
 * is 700, past the 90th percentile. When it does trim, it stops on a sentence
 * boundary and adds no ellipsis. A mid-word cut still gets one.
 */
const DESCRIPTION_LIMIT = 700;

export function shortDescription(description: string | null): string | null {
  if (!description) return null;
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (cleaned.length <= DESCRIPTION_LIMIT) return cleaned;

  const sentences = cleaned.match(new RegExp(`^.{40,${DESCRIPTION_LIMIT}}[.!?](?=\\s|$)`))?.[0]?.trim();
  if (sentences) return sentences;

  const slice = cleaned.slice(0, DESCRIPTION_LIMIT - 10);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 80 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

/**
 * Only the official PSX profile is quoted as the business description. An
 * inferred summary would read as fact in the one place on the page that is
 * prose rather than a figure, so anything else yields null.
 */
export function officialDescription(metadata: CompanyMetadata): string | null {
  const official = isOfficialPsxProfileSource(metadata.meta.source, metadata.meta.sourceUrl) ? metadata.description : null;
  return shortDescription(official);
}

/** How many filed years the Overview trend bars show. */
export const TREND_YEARS = 4;

/** The fields whose contested readings withhold each trend series. */
export const TREND_FIELDS: Record<keyof Omit<CompanyTrends, "contested">, string[]> = {
  revenue: ["revenue"],
  eps: ["eps"],
  netMargin: ["revenue", "profit_after_tax", "net_profit_margin_pct"],
};

/** The last few filed years of revenue, EPS and net margin, oldest first. */
export function buildTrends(fundamentals: FundamentalsData): CompanyTrends {
  const tail = (points: { year: number; value: number }[]) => points.slice(-TREND_YEARS);
  return {
    revenue: tail(fundamentals.series.revenue?.points ?? []),
    eps: tail(fundamentals.series.eps?.points ?? []),
    netMargin: tail(fundamentals.series.margin?.points ?? []),
    contested: fundamentals.contested.map((c) => ({ year: c.year, field: c.field, reason: c.reason })),
  };
}

const FILING_CATEGORY_LABEL: Record<string, string> = {
  result: "Result",
  dividend: "Dividend",
  board_meeting: "Board meeting",
  material: "Material information",
  corporate_announcement: "Announcement",
};

/** A filing category in words rather than a database token. */
export function filingCategoryLabel(category: string | null | undefined): string {
  return (category && FILING_CATEGORY_LABEL[category]) ?? "Announcement";
}

export function toCompanyFilings(filings: Filing[]): CompanyFiling[] {
  return filings.map((f) => ({
    date: f.date,
    title: f.title,
    category: filingCategoryLabel(f.category),
    url: f.url,
  }));
}

/**
 * The publication a cluster's lead article came from, read off its URL. The
 * cluster table stores no publisher name, and a hostname is honest about where
 * the story is from without pretending to more.
 */
export function newsSourceLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host || null;
  } catch {
    return null;
  }
}

export function toCompanyNews(clusters: NewsCluster[]): CompanyNewsItem[] {
  return clusters.map((c) => ({
    id: c.id,
    title: c.title,
    url: c.url,
    source: newsSourceLabel(c.url),
    publishedAt: c.last_published_at ?? c.first_published_at ?? null,
  }));
}

/**
 * The quote's freshness in the three states a reader needs. "partial" and
 * "needs_review" both mean the figure should be treated as delayed, so they
 * read as stale rather than fresh.
 */
export function quoteFreshness(quote: Pick<Quote, "price" | "meta">): QuoteFreshness {
  if (quote.price === null) return "missing";
  const f = quote.meta.freshness;
  if (f === "fresh") return "fresh";
  if (f === "missing") return "missing";
  return "stale";
}
