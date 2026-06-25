import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "@/lib/ai/openai";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals, refreshTechnicals } from "@/lib/company/technicals";
import type { Candle } from "@/lib/company/types";
import { getCompanyFilings } from "@/lib/company/filings";
import { getCompanyDividends } from "@/lib/company/dividends";
import { refreshQuote, refreshHistory } from "@/lib/engine/market-data";
import { populateAllFundamentals } from "@/lib/engine/fundamentals";
import { computeRatios, refreshRatios, type RatioRow } from "@/lib/engine/ratios";
import { getPortfolio } from "@/lib/portfolio";
import { googleNewsUrl } from "@/lib/news/feeds";
import { fetchRssFeed } from "@/lib/news/rss";
import { matchesHoldingText } from "@/lib/news/matching";

export type ReportDepth = "full" | "brief";
export type ReportPeriod = 3 | 5;

export interface CompanyReportOptions {
  depth: ReportDepth;
  periodYears: ReportPeriod;
  include: {
    financials: boolean;
    valuation: boolean;
    dividends: boolean;
    pricePerformance: boolean;
    filings: boolean;
    news: boolean;
    peers: boolean;
    portfolio: boolean;
  };
  peers: string[];
}

interface StageResult {
  key: string;
  label: string;
  status: "completed" | "skipped" | "failed";
  detail?: string;
  completedAt: string;
}

interface FinancialRow {
  period_type: string;
  fiscal_year: number | null;
  fiscal_period: string | null;
  statement_type: string;
  reported_date: string | null;
  source_type: string | null;
  source_url: string | null;
  confidence: number | null;
  updated_at: string | null;
  data: Record<string, number | string | null>;
}

interface QuoteRow {
  ticker: string;
  price: number | null;
  prev_close: number | null;
  day_change: number | null;
  day_change_pct: number | null;
  volume: number | null;
  as_of: string | null;
  provider: string | null;
  is_realtime: boolean | null;
  last_fetched_at: string | null;
}

interface PayoutRow {
  kind: string;
  term: string | null;
  percentage: number | null;
  dividend_per_share: number | null;
  announcement_date: string | null;
  book_closure_start: string | null;
  raw: string | null;
  source: string | null;
  updated_at: string | null;
}

interface NewsRow {
  title: string;
  url: string;
  source: string | null;
  published_at: string | null;
  ai_summary: string | null;
  snippet: string | null;
  relevance_score: number | null;
  category: string | null;
}

interface PeerRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  quote: QuoteRow | null;
  ratios: Pick<RatioRow, "ratio_name" | "ratio_value" | "source_period">[];
}

export interface ReportSource {
  id: string;
  label: string;
  url?: string;
  asOf?: string | null;
}

export interface AiReportInsight {
  text: string;
  citations: string[];
}

export interface AiReportNarrative {
  executiveSummary: AiReportInsight[];
  positives: AiReportInsight[];
  risks: AiReportInsight[];
  recentDevelopments: AiReportInsight[];
  dataGaps: AiReportInsight[];
}

export interface CompanyReportPayload {
  generatedAt: string;
  title: string;
  ticker: string;
  options: CompanyReportOptions;
  evidence: Record<string, unknown>;
  narrative: AiReportNarrative;
  charts: {
    price: { date: string; close: number; volume: number }[];
    financials: { period: string; revenue: number | null; profitAfterTax: number | null; eps: number | null }[];
    ratios: { name: string; value: number | null; missing: string | null }[];
    dividends: { date: string | null; dps: number | null; kind: string }[];
  };
  sources: ReportSource[];
}

const DEFAULT_INCLUDE: CompanyReportOptions["include"] = {
  financials: true,
  valuation: true,
  dividends: true,
  pricePerformance: true,
  filings: true,
  news: true,
  peers: true,
  portfolio: true,
};

export function normalizeCompanyReportOptions(input?: Partial<CompanyReportOptions>): CompanyReportOptions {
  const rawYears = Number(input?.periodYears);
  return {
    depth: input?.depth === "brief" ? "brief" : "full",
    periodYears: rawYears === 3 ? 3 : 5,
    include: { ...DEFAULT_INCLUDE, ...(input?.include ?? {}) },
    peers: [...new Set((input?.peers ?? []).map((p) => p.toUpperCase().trim()).filter(Boolean))].slice(0, 5),
  };
}

export async function generateCompanyReport(
  supabase: SupabaseClient,
  userId: string,
  ticker: string,
  inputOptions?: Partial<CompanyReportOptions>
) {
  const symbol = ticker.toUpperCase().trim();
  const options = normalizeCompanyReportOptions(inputOptions);
  const stages: StageResult[] = [];
  const startedAt = new Date().toISOString();

  async function stage<T>(key: string, label: string, fn: () => Promise<T>, skipped = false): Promise<T | null> {
    if (skipped) {
      stages.push({ key, label, status: "skipped", detail: "Not selected for this report.", completedAt: new Date().toISOString() });
      return null;
    }
    try {
      const value = await fn();
      stages.push({ key, label, status: "completed", completedAt: new Date().toISOString() });
      return value;
    } catch (err) {
      stages.push({
        key,
        label,
        status: "failed",
        detail: err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220),
        completedAt: new Date().toISOString(),
      });
      return null;
    }
  }

  const metadata = await stage("resolve", "Resolving company profile", () => getCompanyMetadata(supabase, symbol));
  const freshQuote = await stage("quote", "Refreshing latest quote", () => refreshQuote(symbol));
  await stage("history", "Refreshing historical price data", () => refreshHistory(symbol), !options.include.pricePerformance);
  const liveTechnicals = await stage("technicals", "Calculating price performance", () => refreshTechnicals(symbol), !options.include.pricePerformance);
  const fundamentals = await stage(
    "financials",
    "Loading latest financial statements and payouts",
    () => populateAllFundamentals(symbol, { maxFilings: options.depth === "full" ? 3 : 1 }),
    !options.include.financials && !options.include.valuation && !options.include.dividends
  );
  await stage("ratios", "Recomputing valuation and quality ratios", () => refreshRatios(supabase, symbol), !options.include.valuation);
  const filings = await stage("filings", "Retrieving official PSX filings", () => getCompanyFilings(symbol, options.depth === "full" ? 30 : 12), !options.include.filings);
  const freshNews = await stage("news", "Checking recent verified news", () => fetchFreshCompanyNews(symbol, metadata?.companyName ?? null, metadata?.sector ?? null), !options.include.news);

  const [quoteRes, financialsRes, payoutsRes, storedNewsRes, portfolio, userDividends, technicalsFallback, ratios] = await Promise.all([
    supabase.from("market_quotes").select("ticker, price, prev_close, day_change, day_change_pct, volume, as_of, provider, is_realtime, last_fetched_at").eq("ticker", symbol).maybeSingle(),
    supabase
      .from("company_financials")
      .select("period_type, fiscal_year, fiscal_period, statement_type, reported_date, source_type, source_url, confidence, updated_at, data")
      .eq("ticker", symbol)
      .order("reported_date", { ascending: false })
      .limit(options.depth === "full" ? 40 : 16),
    supabase
      .from("company_payouts")
      .select("kind, term, percentage, dividend_per_share, announcement_date, book_closure_start, raw, source, updated_at")
      .eq("ticker", symbol)
      .order("announcement_date", { ascending: false, nullsFirst: false })
      .limit(24),
    supabase
      .from("news_articles")
      .select("title, url, source, published_at, ai_summary, snippet, relevance_score, category")
      .eq("user_id", userId)
      .eq("ticker", symbol)
      .eq("ignored", false)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(12),
    options.include.portfolio ? getPortfolio(supabase, userId) : Promise.resolve(null),
    options.include.dividends ? getCompanyDividends(supabase, userId, symbol) : Promise.resolve([]),
    liveTechnicals ? Promise.resolve(liveTechnicals) : getTechnicals(supabase, symbol),
    options.include.valuation ? computeRatios(supabase, symbol) : Promise.resolve([]),
  ]);

  const quote = mergeQuote(symbol, (quoteRes.data as QuoteRow | null) ?? null, freshQuote);
  const financials = (financialsRes.data ?? []) as FinancialRow[];
  const payouts = (payoutsRes.data ?? []) as PayoutRow[];
  const storedNews = (storedNewsRes.data ?? []) as NewsRow[];
  const technicals = technicalsFallback;
  const pricePerformance = options.include.pricePerformance ? buildPricePerformance(technicals.history, options.periodYears) : null;
  const holding = portfolio?.holdings.find((h) => h.ticker === symbol) ?? null;
  const peers = options.include.peers ? await stage("peers", "Comparing selected peers", () => buildPeerRows(supabase, symbol, metadata?.sector ?? null, options.peers)) : null;

  const mergedNews = mergeNews(freshNews ?? [], storedNews);
  const sourceRegister = buildSourceRegister({
    symbol,
    quote,
    technicalsSource: technicals.meta.source,
    financials,
    filings: filings ?? [],
    payouts,
    news: mergedNews,
  });

  const evidence = {
    generatedAt: new Date().toISOString(),
    options,
    company: metadata,
    quote,
    technicals: {
      asOfDate: technicals.asOfDate,
      latestPrice: technicals.latestPrice,
      dayChangePct: technicals.dayChangePct,
      volume: technicals.volume,
      averageVolume: technicals.averageVolume,
      fiftyTwoWeekHigh: technicals.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: technicals.fiftyTwoWeekLow,
      volatility: technicals.volatility,
      movingAverages: { ma20: technicals.ma20, ma50: technicals.ma50, ma100: technicals.ma100, ma200: technicals.ma200 },
      rsi: technicals.rsi,
      flags: technicals.flags,
      pricePerformance,
    },
    financials: summarizeFinancials(financials, options.periodYears),
    ratios: summarizeRatios(ratios),
    payouts: payouts.map((p) => ({
      kind: p.kind,
      term: p.term,
      percentage: p.percentage,
      dividendPerShare: p.dividend_per_share,
      announcementDate: p.announcement_date,
      bookClosureStart: p.book_closure_start,
      raw: p.raw,
      source: p.source,
    })),
    userDividends: userDividends.slice(0, 20),
    filings: filings ?? [],
    news: mergedNews,
    portfolio: holding
      ? {
          quantity: holding.quantity,
          avgCost: holding.avg_cost,
          marketValue: holding.market_value,
          unrealizedPl: holding.unrealized_pl,
          unrealizedPlPct: holding.unrealized_pl_pct,
          dividendIncome: holding.dividend_income,
          weight: holding.weight,
          sectorWeight: portfolio?.sectorWeights.find((s) => s.sector === holding.sector)?.weight ?? null,
        }
      : { held: false },
    peers: peers ?? [],
    refreshResult: fundamentals,
    stages,
    sourceRegister,
  };

  const title = `${options.depth === "full" ? "Full Company Report" : "Investment Brief"} — ${symbol}`;
  const { narrative, model } = await generateAiNarrative(symbol, evidence, options);
  const payload: CompanyReportPayload = {
    generatedAt: evidence.generatedAt,
    title,
    ticker: symbol,
    options,
    evidence: evidence as unknown as Record<string, unknown>,
    narrative,
    charts: {
      price: compactPriceSeries(technicals.history, options.periodYears),
      financials: financialSeries(financials, options.periodYears),
      ratios: ratioSeries(ratios),
      dividends: payoutSeries(payouts),
    },
    sources: sourceRegister,
  };
  const finalContent = buildReportMarkdown(payload);

  const { data: saved, error } = await supabase
    .from("ai_briefings")
    .insert({
      user_id: userId,
      briefing_type: "company_report",
      ticker: symbol,
      title,
      content: finalContent,
      model,
      meta: {
        kind: "company_report",
        reportVersion: 1,
        options,
        generatedAt: evidence.generatedAt,
        startedAt,
        stages,
        reportPayload: payload,
        dataAsOf: {
          quote: quote?.last_fetched_at ?? quote?.as_of ?? null,
          technicals: technicals.meta.lastUpdated ?? technicals.asOfDate,
          latestFinancialUpdatedAt: latestDate(financials.map((f) => f.updated_at)),
          latestFilingDate: latestDate((filings ?? []).map((f) => f.date)),
          latestNewsDate: latestDate(mergedNews.map((n) => n.publishedAt)),
        },
        sources: sourceRegister,
      },
    })
    .select("id, title, content, created_at, model, meta")
    .single();
  if (error) throw error;

  return {
    message: `${title} generated using refreshed market data, filings, financials, payouts and recent news where available.`,
    result: saved,
    stages,
  };
}

const REPORT_SYSTEM_PROMPT = `You write tightly constrained Pakistan Stock Exchange research insights.

Use only the structured evidence in the prompt. DeepSeek is the synthesis/writing model only; do not invent market data, financials, news, filings, valuation inputs or calculations.

Rules:
- Every insight must cite source IDs from the source register, such as S1 or S4.
- If a metric is missing, say it is not available in the evidence and name the missing input.
- Do not create buy/sell/hold calls, target prices, guaranteed upside/downside, or "safe investment" labels.
- Clearly separate official company/PSX disclosures from independent interpretation.
- For banks, insurers, REITs, funds or other financial institutions, avoid forcing industrial metrics when unavailable or inappropriate.
- Return concise JSON only. No Markdown.
- Do not reveal hidden reasoning or chain-of-thought.`;

async function generateAiNarrative(
  symbol: string,
  evidence: unknown,
  options: CompanyReportOptions
): Promise<{ narrative: AiReportNarrative; model: string }> {
  const { data, model } = await chatJson<AiReportNarrative>(
    REPORT_SYSTEM_PROMPT,
    [
      `Ticker: ${symbol}`,
      `Depth: ${options.depth}; period: ${options.periodYears} years.`,
      "Return exactly this JSON shape:",
      `{"executiveSummary":[{"text":"fact-based insight","citations":["S1"]}],"positives":[],"risks":[],"recentDevelopments":[],"dataGaps":[]}`,
      "Use 3-5 executive summary items, 2-4 positives, 2-4 risks, 2-4 recent developments, and 2-4 data gaps. Keep each text under 32 words.",
      "Structured evidence:",
      JSON.stringify(compactEvidenceForAi(evidence), null, 2),
    ].join("\n"),
    options.depth === "full" ? 2200 : 1400
  );

  return { narrative: normalizeNarrative(data), model };
}

function compactEvidenceForAi(evidence: unknown): unknown {
  const e = evidence as {
    company?: unknown;
    quote?: unknown;
    technicals?: unknown;
    financials?: unknown[];
    ratios?: unknown[];
    payouts?: unknown[];
    filings?: unknown[];
    news?: unknown[];
    portfolio?: unknown;
    peers?: unknown[];
    sourceRegister?: unknown[];
  };
  return {
    company: e.company,
    quote: e.quote,
    technicals: e.technicals,
    financials: e.financials?.slice(0, 16),
    ratios: e.ratios?.slice(0, 50),
    payouts: e.payouts?.slice(0, 12),
    filings: e.filings?.slice(0, 16),
    news: e.news?.slice(0, 12),
    portfolio: e.portfolio,
    peers: e.peers?.slice(0, 5),
    sourceRegister: e.sourceRegister,
  };
}

function normalizeNarrative(input: Partial<AiReportNarrative>): AiReportNarrative {
  const clean = (items: unknown): AiReportInsight[] =>
    Array.isArray(items)
      ? items
          .map((item) => {
            const x = item as Partial<AiReportInsight>;
            return {
              text: String(x.text ?? "").trim(),
              citations: Array.isArray(x.citations) ? x.citations.map(String).filter(Boolean).slice(0, 4) : [],
            };
          })
          .filter((item) => item.text)
          .slice(0, 6)
      : [];
  return {
    executiveSummary: clean(input.executiveSummary),
    positives: clean(input.positives),
    risks: clean(input.risks),
    recentDevelopments: clean(input.recentDevelopments),
    dataGaps: clean(input.dataGaps),
  };
}

function buildReportMarkdown(payload: CompanyReportPayload): string {
  const company = payload.evidence.company as { companyName?: string | null; sector?: string | null } | null;
  const quote = payload.evidence.quote as QuoteRow | null;
  const technicals = payload.evidence.technicals as { pricePerformance?: Record<string, number | string | null> | null } | null;
  const metrics = [
    `Company: ${company?.companyName ?? "name unavailable"}${company?.sector ? ` (${company.sector})` : ""}`,
    `Latest price: ${quote?.price ?? "n/a"} as of ${quote?.as_of ?? quote?.last_fetched_at ?? "n/a"}`,
    `1Y return: ${fmtMetric(technicals?.pricePerformance?.oneYearReturnPct, "%")}`,
    `Max drawdown: ${fmtMetric(technicals?.pricePerformance?.maxDrawdownPct, "%")}`,
  ];
  return [
    `# ${payload.title}`,
    "",
    `Generated using verified market data, financial statements, official filings and recent news available as of ${payload.generatedAt}.`,
    "",
    "## Snapshot",
    ...metrics.map((m) => `- ${m}`),
    "",
    "## Executive Summary",
    ...markdownInsights(payload.narrative.executiveSummary),
    "",
    "## Positives",
    ...markdownInsights(payload.narrative.positives),
    "",
    "## Risks",
    ...markdownInsights(payload.narrative.risks),
    "",
    "## Recent Developments",
    ...markdownInsights(payload.narrative.recentDevelopments),
    "",
    "## Data Gaps",
    ...markdownInsights(payload.narrative.dataGaps),
    "",
    "## PDF",
    "Use the PDF download button for the full visual report with charts, tables, and source register.",
    "",
    "## Source Register",
    ...payload.sources.map((s) => `- [${s.id}] ${s.label}${s.asOf ? `, as of ${s.asOf}` : ""}${s.url ? ` — ${s.url}` : ""}`),
  ].join("\n");
}

function markdownInsights(items: AiReportInsight[]): string[] {
  if (!items.length) return ["- No model insight generated for this section."];
  return items.map((item) => `- ${item.text}${item.citations.length ? ` [${item.citations.join(", ")}]` : ""}`);
}

function fmtMetric(value: unknown, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : "n/a";
}

async function fetchFreshCompanyNews(ticker: string, companyName: string | null, sector: string | null) {
  const holding = { ticker, company_name: companyName, sector };
  const queries = [
    `${ticker} ${companyName ?? ""} Pakistan Stock Exchange`,
    companyName ? `"${companyName}" financial results dividend Pakistan` : `${ticker} PSX financial results dividend`,
    companyName ? `"${companyName}" Pakistan business news` : `${ticker} Pakistan business news`,
  ].filter(Boolean);
  const out: { title: string; url: string; source: string; publishedAt: string | null; snippet: string; provider: string }[] = [];
  const known = new Set<string>();

  async function addFromFeed(url: string, provider: string, max = 8) {
    const items = await fetchRssFeed(url);
    for (const item of items.slice(0, max)) {
      if (!matchesHoldingText(holding, [item.title, item.description, item.link])) continue;
      if (known.has(item.link)) continue;
      known.add(item.link);
      out.push({
        title: item.title,
        url: item.link,
        source: item.source ?? safeHostname(item.link),
        publishedAt: item.pubDate,
        snippet: (item.description || item.title).slice(0, 900),
        provider,
      });
    }
  }

  const feedJobs = [
    ...queries.map((query) => addFromFeed(googleNewsUrl(query), "google-news", 5)),
    addFromFeed("https://www.brecorder.com/feeds/markets", "rss", 12),
    addFromFeed("https://www.brecorder.com/feeds/latest-news", "rss", 12),
    addFromFeed("https://www.dawn.com/feeds/business", "rss", 10),
    addFromFeed("https://tribune.com.pk/feed/business", "rss", 10),
  ];

  const settled = await Promise.allSettled(feedJobs);
  void settled;

  return out
    .sort((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt))
    .slice(0, 12);
}

async function buildPeerRows(
  supabase: SupabaseClient,
  ticker: string,
  sector: string | null,
  selectedPeers: string[]
): Promise<PeerRow[]> {
  const peers = selectedPeers.length ? selectedPeers : await autoPeers(supabase, ticker, sector);
  const symbols = peers.filter((p) => p !== ticker).slice(0, 5);
  await Promise.allSettled(symbols.map((p) => refreshQuote(p)));
  await Promise.allSettled(symbols.map((p) => refreshRatios(supabase, p)));

  const rows: PeerRow[] = [];
  for (const peer of symbols) {
    const [meta, quoteRes, ratios] = await Promise.all([
      getCompanyMetadata(supabase, peer),
      supabase.from("market_quotes").select("ticker, price, prev_close, day_change, day_change_pct, volume, as_of, provider, is_realtime, last_fetched_at").eq("ticker", peer).maybeSingle(),
      computeRatios(supabase, peer),
    ]);
    rows.push({
      ticker: peer,
      companyName: meta.companyName,
      sector: meta.sector,
      quote: (quoteRes.data as QuoteRow | null) ?? null,
      ratios: ratios
        .filter((r) => ["P/E", "P/B", "P/S", "Dividend yield (TTM)", "ROE", "Net margin", "Revenue growth", "EPS growth"].includes(r.ratio_name))
        .map((r) => ({ ratio_name: r.ratio_name, ratio_value: r.ratio_value, source_period: r.source_period })),
    });
  }
  return rows;
}

async function autoPeers(supabase: SupabaseClient, ticker: string, sector: string | null): Promise<string[]> {
  if (!sector) return [];
  const { data } = await supabase
    .from("stock_master")
    .select("ticker")
    .eq("sector", sector)
    .neq("ticker", ticker)
    .order("ticker")
    .limit(5);
  return ((data ?? []) as { ticker: string }[]).map((r) => r.ticker);
}

function summarizeFinancials(rows: FinancialRow[], years: number) {
  const minYear = new Date().getFullYear() - years - 1;
  return rows
    .filter((r) => !r.fiscal_year || r.fiscal_year >= minYear)
    .map((r) => ({
      periodType: r.period_type,
      fiscalYear: r.fiscal_year,
      fiscalPeriod: r.fiscal_period,
      statementType: r.statement_type,
      reportedDate: r.reported_date,
      sourceType: r.source_type,
      sourceUrl: r.source_url,
      confidence: r.confidence,
      updatedAt: r.updated_at,
      units: r.data?._units ?? "as reported",
      data: Object.fromEntries(Object.entries(r.data ?? {}).filter(([key, value]) => !key.startsWith("_") && typeof value === "number")),
    }));
}

function summarizeRatios(rows: RatioRow[]) {
  return rows.map((r) => ({
    name: r.ratio_name,
    value: r.ratio_value,
    formula: r.formula,
    missing: r.missing,
    sourcePeriod: r.source_period,
    source: r.source,
    computedAt: r.computed_at,
  }));
}

function compactPriceSeries(candles: Candle[], years: number): { date: string; close: number; volume: number }[] {
  if (!candles.length) return [];
  const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const firstDate = new Date(latest.date);
  firstDate.setFullYear(firstDate.getFullYear() - years);
  const windowed = sorted.filter((c) => c.date >= firstDate.toISOString().slice(0, 10));
  const sample = windowed.length ? windowed : sorted;
  if (sample.length <= 180) return sample.map((c) => ({ date: c.date, close: c.close, volume: c.volume }));
  const step = (sample.length - 1) / 179;
  const out: Candle[] = [];
  for (let i = 0; i < 180; i++) out.push(sample[Math.round(i * step)]);
  return out.map((c) => ({ date: c.date, close: c.close, volume: c.volume }));
}

function financialSeries(rows: FinancialRow[], years: number): CompanyReportPayload["charts"]["financials"] {
  const minYear = new Date().getFullYear() - years - 1;
  return rows
    .filter((r) => r.statement_type === "income_statement" && (!r.fiscal_year || r.fiscal_year >= minYear))
    .sort((a, b) => (a.fiscal_year ?? 0) - (b.fiscal_year ?? 0) || String(a.fiscal_period ?? "").localeCompare(String(b.fiscal_period ?? "")))
    .map((r) => ({
      period: `${r.fiscal_year ?? "?"} ${r.fiscal_period ?? r.period_type}`.trim(),
      revenue: numericData(r, "revenue"),
      profitAfterTax: numericData(r, "profit_after_tax"),
      eps: numericData(r, "eps"),
    }))
    .slice(-8);
}

function ratioSeries(rows: RatioRow[]): CompanyReportPayload["charts"]["ratios"] {
  const wanted = ["P/E", "P/B", "P/S", "Dividend yield (TTM)", "ROE", "ROA", "Net margin", "Revenue growth", "EPS growth", "Debt-to-equity", "FCF yield"];
  return wanted.map((name) => {
    const row = rows.find((r) => r.ratio_name === name);
    return { name, value: row?.ratio_value ?? null, missing: row?.missing ?? null };
  });
}

function payoutSeries(rows: PayoutRow[]): CompanyReportPayload["charts"]["dividends"] {
  return rows
    .map((r) => ({ date: r.announcement_date ?? r.book_closure_start, dps: r.dividend_per_share, kind: r.kind }))
    .filter((r) => r.date || r.dps !== null)
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")))
    .slice(-12);
}

function numericData(row: FinancialRow, key: string): number | null {
  const value = row.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildPricePerformance(candles: Candle[], years: number) {
  if (!candles.length) return null;
  const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const firstDate = new Date(latest.date);
  firstDate.setFullYear(firstDate.getFullYear() - years);
  const windowed = sorted.filter((c) => c.date >= firstDate.toISOString().slice(0, 10));
  const sample = windowed.length ? windowed : sorted;
  const ret = (days: number) => returnSince(sorted, latest, days);
  return {
    asOfDate: latest.date,
    latestClose: latest.close,
    oneMonthReturnPct: ret(30),
    threeMonthReturnPct: ret(90),
    ytdReturnPct: returnSinceDate(sorted, latest, `${latest.date.slice(0, 4)}-01-01`),
    oneYearReturnPct: ret(365),
    threeYearReturnPct: years >= 3 ? ret(365 * 3) : null,
    fiveYearReturnPct: years >= 5 ? ret(365 * 5) : null,
    maxDrawdownPct: maxDrawdown(sample),
    observationCount: sample.length,
  };
}

function returnSince(candles: Candle[], latest: Candle, days: number): number | null {
  const d = new Date(latest.date);
  d.setDate(d.getDate() - days);
  return returnSinceDate(candles, latest, d.toISOString().slice(0, 10));
}

function returnSinceDate(candles: Candle[], latest: Candle, startDate: string): number | null {
  const start = candles.find((c) => c.date >= startDate) ?? candles[0];
  if (!start || start.close === 0) return null;
  return ((latest.close - start.close) / start.close) * 100;
}

function maxDrawdown(candles: Candle[]): number | null {
  let peak = 0;
  let worst = 0;
  for (const candle of candles) {
    peak = Math.max(peak, candle.close);
    if (peak > 0) worst = Math.min(worst, ((candle.close - peak) / peak) * 100);
  }
  return candles.length ? worst : null;
}

function mergeNews(
  fresh: { title: string; url: string; source: string; publishedAt: string | null; snippet: string; provider: string }[],
  stored: NewsRow[]
) {
  const known = new Set<string>();
  const out: { title: string; url: string; source: string | null; publishedAt: string | null; summary: string | null; snippet: string | null; relevanceScore: number | null; category: string | null; provider: string }[] = [];
  for (const n of fresh) {
    if (known.has(n.url)) continue;
    known.add(n.url);
    out.push({ title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt, summary: null, snippet: n.snippet, relevanceScore: null, category: "general", provider: n.provider });
  }
  for (const n of stored) {
    if (known.has(n.url)) continue;
    known.add(n.url);
    out.push({ title: n.title, url: n.url, source: n.source, publishedAt: n.published_at, summary: n.ai_summary, snippet: n.snippet?.slice(0, 700) ?? null, relevanceScore: n.relevance_score, category: n.category, provider: "stored" });
  }
  return out.slice(0, 14);
}

function mergeQuote(symbol: string, row: QuoteRow | null, fresh: Awaited<ReturnType<typeof refreshQuote>> | null): QuoteRow | null {
  if (row) return row;
  if (!fresh) return null;
  return {
    ticker: symbol,
    price: fresh.price,
    prev_close: fresh.prevClose,
    day_change: fresh.prevClose !== null ? fresh.price - fresh.prevClose : null,
    day_change_pct: fresh.prevClose ? ((fresh.price - fresh.prevClose) / fresh.prevClose) * 100 : null,
    volume: fresh.volume,
    as_of: fresh.asOf,
    provider: fresh.provider,
    is_realtime: fresh.isRealtime,
    last_fetched_at: new Date().toISOString(),
  };
}

function buildSourceRegister(input: {
  symbol: string;
  quote: QuoteRow | null;
  technicalsSource: string | null;
  financials: FinancialRow[];
  filings: { date: string | null; title: string; url: string; source: string }[];
  payouts: PayoutRow[];
  news: { title: string; url: string; source: string | null; publishedAt: string | null }[];
}) {
  const sources: { id: string; label: string; url?: string; asOf?: string | null }[] = [];
  sources.push({ id: "S1", label: `Latest market quote for ${input.symbol} from ${input.quote?.provider ?? "market provider"}`, asOf: input.quote?.last_fetched_at ?? input.quote?.as_of ?? null });
  sources.push({ id: "S2", label: `Historical PSX price data and technical calculations from ${input.technicalsSource ?? "PSX DPS"}` });

  const financialUrls = [...new Set(input.financials.map((f) => f.source_url).filter((u): u is string => !!u))].slice(0, 8);
  financialUrls.forEach((url, index) => sources.push({ id: `S${sources.length + 1}`, label: `Structured financial statement extract ${index + 1}`, url }));
  if (!financialUrls.length && input.financials.length) sources.push({ id: `S${sources.length + 1}`, label: "Structured financial statement rows from company_financials" });

  if (input.payouts.length) sources.push({ id: `S${sources.length + 1}`, label: "Official PSX payout history", asOf: latestDate(input.payouts.map((p) => p.updated_at)) });

  input.filings.slice(0, 10).forEach((f) => sources.push({ id: `S${sources.length + 1}`, label: `Official PSX filing: ${f.title}`, url: f.url, asOf: f.date }));
  input.news.slice(0, 10).forEach((n) => sources.push({ id: `S${sources.length + 1}`, label: `Recent news: ${n.title} (${n.source ?? "source unknown"})`, url: n.url, asOf: n.publishedAt }));
  sources.push({ id: `S${sources.length + 1}`, label: "User portfolio holdings, transactions and dividend ledger" });
  return sources;
}

function latestDate(values: (string | null | undefined)[]): string | null {
  return values.filter((v): v is string => !!v).sort().at(-1) ?? null;
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
