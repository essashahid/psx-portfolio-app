import { companyAliases, matchesHoldingText, normalizeForMatch } from "@/lib/news/matching";
import type { NewsItem } from "./types";

const REJECT_PATTERNS = [
  /\bagricultur(e|al)\b/i,
  /\bindian\b.*\bmining\b/i,
  /\bgulf\b.*\bmarket\b(?!.*pakistan)/i,
  /\bnse\b|\bbse\b|\bsensex\b/i,
  /\bcrypto\b|\bbitcoin\b/i,
];

const QUALITY_SOURCES = ["dawn", "tribune", "business recorder", "mgn", "brecorder", "reuters", "bloomberg", "profit", "mettis", "darson", "arif habib", "topline", "capital stake", "invest capital"];
const LOW_QUALITY_SOURCES = ["reddit", "twitter", "facebook", "forum", "blog", "youtube", "tiktok", "instagram"];

const OFFICIAL_DISCLOSURE_HINTS = [
  "financial result",
  "board meeting",
  "material information",
  "corporate action",
  "dividend",
  "right issue",
  "bonus",
  "psx",
  "pakistan stock exchange",
];

interface RawNewsInput {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
  summary?: string | null;
  snippet?: string | null;
  relevanceScore?: number | null;
  category?: string | null;
  provider: string;
}

interface CompanyContext {
  ticker: string;
  companyName: string;
  sector: string | null;
  aliases: string[];
}

export function buildCompanyContext(ticker: string, companyName: string, sector: string | null): CompanyContext {
  return {
    ticker: ticker.toUpperCase(),
    companyName,
    sector,
    aliases: companyAliases(companyName),
  };
}

export function scoreNewsRelevance(
  article: { title: string; snippet?: string | null; url?: string; source?: string | null },
  ctx: CompanyContext
): { score: number; explanation: string } {
  const text = [article.title, article.snippet ?? ""].join(" ");
  const normalized = normalizeForMatch(text);
  const compact = normalized.replace(/\s+/g, "");
  const words = new Set(normalized.split(/\s+/).filter(Boolean));
  const ticker = ctx.ticker.toLowerCase();

  let score = 0;
  const reasons: string[] = [];

  if (ticker.length >= 5 && compact.includes(ticker)) {
    score += 0.45;
    reasons.push("exact ticker match");
  } else if (words.has(ticker)) {
    score += 0.4;
    reasons.push("ticker token match");
  }

  for (const alias of ctx.aliases) {
    const a = normalizeForMatch(alias);
    if (a.length >= 6 && compact.includes(a.replace(/\s+/g, ""))) {
      score += 0.35;
      reasons.push(`company name match (${alias})`);
      break;
    }
  }

  if (ctx.sector && normalized.includes(normalizeForMatch(ctx.sector))) {
    score += 0.05;
    reasons.push("sector context");
  }

  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(text)) {
      score -= 0.5;
      reasons.push("rejected pattern");
      break;
    }
  }

  const holdingMatch = matchesHoldingText(
    { ticker: ctx.ticker, company_name: ctx.companyName },
    [article.title, article.snippet ?? ""]
  );
  if (holdingMatch) {
    score = Math.max(score, 0.55);
    if (!reasons.length) reasons.push("holding text match");
  }

  // Publication quality scoring
  let sourceMultiplier = 1.0;
  if (article.source) {
    const s = article.source.toLowerCase();
    if (QUALITY_SOURCES.some(q => s.includes(q))) {
      sourceMultiplier = 1.25; // 25% boost for premium financial journalism
      reasons.push("high-quality source");
    } else if (LOW_QUALITY_SOURCES.some(q => s.includes(q))) {
      sourceMultiplier = 0.6; // Heavy penalty for social/unverified media
      reasons.push("low-quality source penalty");
    }
  }

  score *= sourceMultiplier;

  return { score: Math.max(0, Math.min(1, score)), explanation: reasons.join("; ") || "weak overlap" };
}

export function isOfficialDisclosure(title: string, url: string, source: string | null): boolean {
  const blob = `${title} ${url} ${source ?? ""}`.toLowerCase();
  if (blob.includes("psx.com.pk") || blob.includes("dps.psx")) return true;
  return OFFICIAL_DISCLOSURE_HINTS.some((h) => blob.includes(h));
}

function canonicalHeadline(title: string): string {
  return normalizeForMatch(title).replace(/\s+/g, " ").trim();
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function filterAndDedupeNews(
  items: RawNewsInput[],
  ctx: CompanyContext,
  minScore = 0.45,
  maxItems = 14,
  sinceDays = 90
): NewsItem[] {
  const since = Date.now() - sinceDays * 86400_000;
  const seenUrl = new Set<string>();
  const seenHeadline = new Set<string>();
  const out: NewsItem[] = [];

  const sorted = [...items].sort((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt));

  for (const item of sorted) {
    if (item.publishedAt && timestamp(item.publishedAt) < since) continue;
    const urlKey = canonicalUrl(item.url);
    const headlineKey = canonicalHeadline(item.title);
    const isDup = seenUrl.has(urlKey) || seenHeadline.has(headlineKey);
    if (seenUrl.has(urlKey) || seenHeadline.has(headlineKey) && out.some((o) => o.title === item.title)) continue;

    const { score, explanation } = scoreNewsRelevance(item, ctx);
    if (score < minScore) continue;

    seenUrl.add(urlKey);
    seenHeadline.add(headlineKey);

    out.push({
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
      summary: item.summary ?? null,
      snippet: item.snippet?.slice(0, 700) ?? null,
      relevanceScore: score,
      relevanceExplanation: explanation,
      category: item.category ?? categorize(item.title),
      isOfficialDisclosure: isOfficialDisclosure(item.title, item.url, item.source),
      isDuplicate: isDup,
      provider: item.provider,
    });
  }

  return out.slice(0, maxItems);
}

export function separateFilingsFromNews(
  news: NewsItem[],
  filings: { title: string; url: string; date: string | null; category?: string }[]
): {
  officialFilings: { title: string; url: string; date: string | null; category: string; summary: string | null }[];
  independentNews: NewsItem[];
  sectorNews: NewsItem[];
} {
  const filingUrls = new Set(filings.map((f) => canonicalUrl(f.url)));
  const filingHeadlines = new Set(filings.map((f) => canonicalHeadline(f.title)));

  const officialFilings = filings.map((f) => ({
    title: f.title,
    url: f.url,
    date: f.date,
    category: f.category ?? "official_disclosure",
    summary: null,
  }));

  const independentNews: NewsItem[] = [];
  const sectorNews: NewsItem[] = [];

  for (const n of news) {
    const urlMatch = filingUrls.has(canonicalUrl(n.url));
    const headlineMatch = filingHeadlines.has(canonicalHeadline(n.title));
    if (n.isOfficialDisclosure || urlMatch || headlineMatch) continue;
    if (n.category === "sector" || n.category === "macro") {
      sectorNews.push(n);
    } else {
      independentNews.push(n);
    }
  }

  return { officialFilings, independentNews, sectorNews };
}

function categorize(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("dividend")) return "dividend";
  if (t.includes("result") || t.includes("earnings")) return "earnings";
  if (t.includes("expansion") || t.includes("capacity")) return "operations";
  return "general";
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
