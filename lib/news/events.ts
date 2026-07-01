import type { FeedNewsArticle } from "@/lib/news/global-store";

export type EventVerification = "Official" | "Confirmed" | "Reported" | "Analysis" | "Opinion" | "Unverified";
export type EventImportance = "Critical" | "High" | "Medium" | "Routine";
export type EventCardKind = "featured" | "suggested" | "standard" | "brief";

export type NewsEvent = {
  id: string;
  primaryArticleId: string;
  storage: "global" | "legacy";
  title: string;
  summary: string | null;
  url: string;
  source: string;
  category: string;
  eventType: string;
  verification: EventVerification;
  sourceStatus: string;
  importance: EventImportance;
  cardKind: EventCardKind;
  suggested: boolean;
  whySuggested: string | null;
  potentialRelevance: string | null;
  affectedHoldings: string[];
  affectedSectors: string[];
  affectedAssets: string[];
  whatToWatch: string[];
  timeLabel: string;
  dateKey: string;
  timestamp: number;
  relatedSources: string[];
  relatedCount: number;
  saved: boolean;
  ignored: boolean;
  lowConfidence: boolean;
};

export type HoldingContext = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  weight?: number | null;
};

export type NewsEventContext = {
  holdings: HoldingContext[];
  watchlist: string[];
};

const CATEGORY_LABEL: Record<string, string> = {
  policy: "Policy event",
  regulatory: "Regulatory event",
  economy: "Macro event",
  commodity: "Commodity event",
  forex: "Currency event",
  crypto: "Crypto event",
  funds: "Fund event",
  market: "Market event",
  international: "Global market event",
  geopolitics: "Geopolitical event",
  earnings: "Earnings event",
  result: "Result announcement",
  dividend: "Dividend event",
  corporate_announcement: "Company filing",
  company: "Company event",
  general: "Reported event",
};

const OFFICIAL_HINTS = [
  "psx",
  "pucars",
  "company announcements",
  "state bank",
  "sbp",
  "secp",
  "pbs",
  "fbr",
  "nepra",
  "ogra",
  "government",
  "ministry",
  "exchange",
];

const OPINION_HINTS = ["opinion", "column", "blog", "analysis"];

export function buildNewsEvents(articles: FeedNewsArticle[], context: NewsEventContext): NewsEvent[] {
  const clusters = new Map<string, FeedNewsArticle[]>();
  for (const article of articles) {
    if (article.ignored && !article.saved) continue;
    const key = clusterKey(article);
    const bucket = clusters.get(key);
    if (bucket) bucket.push(article);
    else clusters.set(key, [article]);
  }

  return [...clusters.values()]
    .map((rows) => buildEvent(rows, context))
    .filter((event): event is NewsEvent => !!event)
    .sort(
      (a, b) =>
        importanceRank(b.importance) - importanceRank(a.importance) ||
        Number(b.suggested) - Number(a.suggested) ||
        b.timestamp - a.timestamp
    );
}

export function cleanNewsText(value: string | null | undefined): string | null {
  if (!value) return null;
  let out = value;
  out = out.replace(/<script[\s\S]*?<\/script>/gi, " ");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, " ");
  out = out.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeEntities(out);
  out = out.replace(/https?:\/\/\S+/gi, " ");
  out = out.replace(/\bRead full article\b.*$/i, " ");
  out = out.replace(/\bView full coverage on Google News\b.*$/i, " ");
  out = out.replace(/\s+-\s+[A-Z][A-Za-z .&'-]{2,}$/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  if (!out || /<\w+|href=|script/i.test(out)) return null;
  if (out.length < 18) return null;
  return out.length > 360 ? `${out.slice(0, 357).trim()}...` : out;
}

export function eventMatchesSearch(event: NewsEvent, query: string | null | undefined): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  return [
    event.title,
    event.summary ?? "",
    event.source,
    event.category,
    event.eventType,
    ...event.affectedHoldings,
    ...event.affectedSectors,
    ...event.affectedAssets,
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function buildEvent(rows: FeedNewsArticle[], context: NewsEventContext): NewsEvent | null {
  const sorted = [...rows].sort(
    (a, b) =>
      sourcePriority(b) - sourcePriority(a) ||
      (b.relevance_score ?? 0) - (a.relevance_score ?? 0) ||
      articleTime(b) - articleTime(a)
  );
  const primary = sorted[0];
  if (!primary?.url || !primary.title) return null;

  const title = cleanTitle(primary.title);
  const summary = cleanNewsText(primary.ai_summary) ?? cleanNewsText(primary.snippet);
  const source = cleanSource(primary.source, primary.url);
  const category = primary.category ?? "general";
  const eventType = CATEGORY_LABEL[category] ?? "Reported event";
  const verification = verificationFor(primary, sorted);
  const relatedSources = [...new Set(sorted.map((row) => cleanSource(row.source, row.url)).filter(Boolean))];
  const affected = affectedFor(primary, context);
  const suggested = affected.holdings.length > 0 || affected.watchlist.length > 0 || !!primary.why_it_matters;
  const whySuggested = reasonFor(primary, context, affected);
  const potentialRelevance = relevanceFor(primary, affected);
  const importance = importanceFor(primary, verification, affected, sorted.length);
  const time = articleTime(primary);
  const relatedCount = Math.max(0, sorted.length - 1);

  return {
    id: clusterKey(primary),
    primaryArticleId: primary.global_article_id ?? primary.legacy_article_id ?? primary.id,
    storage: primary.storage,
    title,
    summary,
    url: primary.url,
    source,
    category,
    eventType,
    verification,
    sourceStatus: sourceStatus(verification, sorted.length),
    importance,
    cardKind: "standard",
    suggested,
    whySuggested,
    potentialRelevance,
    affectedHoldings: [...new Set([...affected.holdings, ...affected.watchlist])],
    affectedSectors: affected.sectors,
    affectedAssets: affected.assets,
    whatToWatch: whatToWatch(category, affected),
    timeLabel: formatWhen(primary.published_at ?? primary.created_at),
    dateKey: dateKey(primary),
    timestamp: time,
    relatedSources,
    relatedCount,
    saved: sorted.some((row) => row.saved),
    ignored: sorted.every((row) => row.ignored),
    lowConfidence: sorted.every((row) => row.low_confidence),
  };
}

function affectedFor(article: FeedNewsArticle, context: NewsEventContext) {
  const owned = new Map(context.holdings.map((h) => [h.ticker, h]));
  const watch = new Set(context.watchlist);
  const holdings: string[] = [];
  const watchlist: string[] = [];
  const sectors = new Set<string>();
  const assets = new Set<string>();

  const tickers = [article.ticker, ...(article.impact_tickers ?? [])].filter((t): t is string => !!t);
  for (const ticker of tickers) {
    if (owned.has(ticker)) {
      holdings.push(ticker);
      const sector = owned.get(ticker)?.sector;
      if (sector) sectors.add(sector);
    } else if (watch.has(ticker)) {
      watchlist.push(ticker);
    }
  }

  if (article.sector && context.holdings.some((h) => h.sector === article.sector)) sectors.add(article.sector);
  if (article.category === "commodity") assets.add("Commodities");
  if (article.category === "forex") assets.add("PKR / USD");
  if (article.category === "market") assets.add("KSE-100");
  if (article.category === "international" || article.category === "geopolitics") assets.add("Global markets");
  if (article.category === "crypto") assets.add("Crypto");
  if (article.category === "funds") assets.add("Mutual funds");

  return {
    holdings: [...new Set(holdings)],
    watchlist: [...new Set(watchlist)],
    sectors: [...sectors],
    assets: [...assets],
  };
}

function reasonFor(article: FeedNewsArticle, context: NewsEventContext, affected: ReturnType<typeof affectedFor>): string | null {
  const primaryTicker = affected.holdings[0];
  if (primaryTicker) {
    const holding = context.holdings.find((h) => h.ticker === primaryTicker);
    const weight = typeof holding?.weight === "number" ? `, representing ${holding.weight.toFixed(1)}% of your portfolio` : "";
    return `You own ${primaryTicker}${weight}.`;
  }
  if (affected.watchlist[0]) return `${affected.watchlist[0]} is on your watchlist.`;
  if (affected.sectors[0]) return `This affects ${affected.sectors[0]}, a sector represented in your portfolio.`;
  if (article.why_it_matters) return cleanNewsText(article.why_it_matters);
  if (article.scope === "market") return "This is a market-wide development relevant to PSX context.";
  return null;
}

function relevanceFor(article: FeedNewsArticle, affected: ReturnType<typeof affectedFor>): string | null {
  const direct = affected.holdings.length > 0 || affected.watchlist.length > 0;
  if (article.why_it_matters) return cleanNewsText(article.why_it_matters);
  if (direct && article.category === "dividend") return "This may affect expected income timing or payout assumptions.";
  if (direct && (article.category === "result" || article.category === "earnings")) return "This may affect how the latest business performance compares with your thesis.";
  if (affected.sectors.length > 0 && article.category === "commodity") return "Input-cost changes may influence margins, although the company-specific effect is uncertain.";
  if (article.category === "policy" || article.category === "regulatory") return "Policy or regulatory changes may influence financing costs, pricing, or sector operating conditions.";
  if (article.category === "economy" || article.category === "forex") return "Macro changes may influence rates, currency-sensitive revenues, costs, or market valuations.";
  if (article.scope === "market") return "This may shape broader market sentiment and liquidity.";
  return null;
}

function whatToWatch(category: string, affected: ReturnType<typeof affectedFor>): string[] {
  if (category === "dividend") return ["Official book-closure or payment date", "Eligibility against your holding period", "Cash credit in your broker statement"];
  if (category === "result" || category === "earnings") return ["Next quarterly margin trend", "Management commentary", "Dividend or payout follow-up"];
  if (category === "policy" || category === "regulatory") return ["Official notification", "Effective date", "Company or sector guidance"];
  if (category === "commodity") return ["Input-cost pass-through", "Next gross margin", "Further price notifications"];
  if (category === "forex") return ["PKR trend", "Import-cost exposure", "Export revenue sensitivity"];
  if (category === "market") return ["Trading breadth", "Foreign flow", "Volume confirmation"];
  if (affected.holdings.length) return ["Company clarification", "Next financial result", "Portfolio thesis impact"];
  return ["Official confirmation", "Follow-up reporting", "Any disclosed financial magnitude"];
}

function verificationFor(article: FeedNewsArticle, rows: FeedNewsArticle[]): EventVerification {
  const haystack = `${article.source ?? ""} ${article.url} ${article.category ?? ""}`.toLowerCase();
  if (OFFICIAL_HINTS.some((hint) => haystack.includes(hint))) return "Official";
  if (OPINION_HINTS.some((hint) => haystack.includes(hint))) return article.category === "geopolitics" ? "Analysis" : "Opinion";
  if (rows.length > 1) return "Confirmed";
  if (article.source_quality === "low" || article.low_confidence) return "Unverified";
  return article.category === "international" || article.category === "geopolitics" ? "Analysis" : "Reported";
}

function sourceStatus(verification: EventVerification, count: number): string {
  if (verification === "Official") return "Officially confirmed";
  if (count > 1) return "Confirmed by multiple sources";
  if (verification === "Unverified") return "Details remain incomplete";
  return "Single-source report";
}

function importanceFor(
  article: FeedNewsArticle,
  verification: EventVerification,
  affected: ReturnType<typeof affectedFor>,
  sourceCount: number
): EventImportance {
  let score = article.relevance_score ?? 4;
  if (verification === "Official") score += 2;
  if (sourceCount > 1) score += 1;
  if (affected.holdings.length) score += 2;
  if (affected.sectors.length) score += 1;
  if (article.category && ["policy", "regulatory", "economy", "market", "dividend", "result", "earnings"].includes(article.category)) score += 1;
  if (article.is_interesting) score += 2;
  if (score >= 11) return "Critical";
  if (score >= 8) return "High";
  if (score >= 5) return "Medium";
  return "Routine";
}

function sourcePriority(article: FeedNewsArticle): number {
  const verification = verificationFor(article, [article]);
  if (verification === "Official") return 5;
  if (article.source_quality === "high") return 4;
  if (article.source_quality === "medium") return 3;
  return 1;
}

function importanceRank(value: EventImportance): number {
  return value === "Critical" ? 4 : value === "High" ? 3 : value === "Medium" ? 2 : 1;
}

function clusterKey(article: FeedNewsArticle): string {
  const title = cleanTitle(article.title)
    .toLowerCase()
    .replace(/\b(pakistan|psx|kse|stock|market|latest|update|report)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 12)
    .join("-");
  return `${article.category ?? "general"}:${article.ticker ?? "market"}:${title || article.url.split("?")[0]}`;
}

function cleanTitle(title: string): string {
  return cleanNewsText(title)?.replace(/\s+-\s+[^-]{2,40}$/g, "").trim() || title.replace(/<[^>]+>/g, "").trim();
}

function cleanSource(source: string | null, url: string): string {
  if (source && source !== "Google News") return cleanNewsText(source) ?? source;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return source ?? "Unknown source";
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function articleTime(article: FeedNewsArticle): number {
  const t = new Date(article.published_at ?? article.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function dateKey(article: FeedNewsArticle): string {
  return new Date(articleTime(article) || Date.now()).toISOString().slice(0, 10);
}

function formatWhen(value: string | null): string {
  if (!value) return "time unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unknown";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-PK", { month: "short", day: "numeric" });
}
