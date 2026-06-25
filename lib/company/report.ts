import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "@/lib/ai/openai";
import { getCompanyMetadata } from "@/lib/company/metadata";
import { getTechnicals, refreshTechnicals } from "@/lib/company/technicals";
import type { CompanyDividendRow, Candle } from "@/lib/company/types";
import type { EnrichedHolding } from "@/lib/types";
import { getCompanyFilings } from "@/lib/company/filings";
import { getCompanyDividends } from "@/lib/company/dividends";
import { refreshQuote, refreshHistory } from "@/lib/engine/market-data";
import { populateAllFundamentals } from "@/lib/engine/fundamentals";
import { computeRatios, refreshRatios, type RatioRow } from "@/lib/engine/ratios";
import { getPortfolio } from "@/lib/portfolio";
import { googleNewsUrl } from "@/lib/news/feeds";
import { fetchRssFeed } from "@/lib/news/rss";
import { matchesHoldingText } from "@/lib/news/matching";

import {
  latestFinancialLabel,
  normalizeFinancialRows,
  summarizeFinancialsForEvidence,
  toChartSeries,
} from "./report/financials";
import { buildReportMarkdown, normalizeNarrative } from "./report/markdown";
import {
  buildCompanyContext,
  filterAndDedupeNews,
  separateFilingsFromNews,
} from "./report/news";
import { autoSelectPeers, buildPeerChartData, buildPeerRows, peerMedian } from "./report/peers";
import {
  buildScenarioAnalysis,
  extractGrossMargin,
  extractPe,
  latestAnnualEps,
  latestAnnualRevenue,
} from "./report/scenarios";
import {
  assertPublishable,
  validateCompanyResolution,
  validateReportBeforePublish,
} from "./report/validation";
import {
  completeReportJob,
  createReportJob,
  failReportJob,
  getReportJob,
  syncJobStages,
  updateReportJobStages,
  type ReportJobStage,
} from "./report/jobs";
import { computeReportDiff, getLatestReportVersion } from "./report/diff";
import { buildPriceChartWithBenchmark, buildTransactionMarkers } from "./report/charts";
import {
  BRIEF_INCLUDE,
  DEFAULT_INCLUDE,
  DEFAULT_OUTPUT,
  type AiReportNarrative,
  type CompanyReportOptions,
  type CompanyReportPayload,
  type NewsPeriodDays,
  type ReportDepth,
  type ReportPeriod,
  type ReportSource,
} from "./report/types";

export type {
  AiReportInsight,
  AiReportNarrative,
  CompanyReportOptions,
  CompanyReportPayload,
  ReportDepth,
  ReportPeriod,
  ReportSource,
} from "./report/types";

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

export function normalizeCompanyReportOptions(input?: Partial<CompanyReportOptions>): CompanyReportOptions {
  const rawYears = Number(input?.periodYears);
  const depth: ReportDepth = input?.depth === "brief" ? "brief" : "full";
  const defaultInclude = depth === "brief" ? BRIEF_INCLUDE : DEFAULT_INCLUDE;
  const newsDays = input?.newsPeriodDays;
  const newsPeriodDays: NewsPeriodDays =
    newsDays === 30 || newsDays === 90 || newsDays === 180 || newsDays === 365 ? newsDays : depth === "brief" ? 90 : 90;

  return {
    depth,
    periodYears: rawYears === 3 ? 3 : 5,
    include: { ...defaultInclude, ...(input?.include ?? {}) },
    peers: [...new Set((input?.peers ?? []).map((p) => p.toUpperCase().trim()).filter(Boolean))].slice(0, 5),
    newsPeriodDays,
    output: { ...DEFAULT_OUTPUT, ...(input?.output ?? {}) },
  };
}

export interface GenerateReportContext {
  jobId?: string;
  parentReportId?: string;
  previousPayload?: CompanyReportPayload;
}

export async function generateCompanyReport(
  supabase: SupabaseClient,
  userId: string,
  ticker: string,
  inputOptions?: Partial<CompanyReportOptions>,
  ctx?: GenerateReportContext
) {
  const symbol = ticker.toUpperCase().trim();
  const options = normalizeCompanyReportOptions(inputOptions);
  const stages: StageResult[] = [];
  const startedAt = new Date().toISOString();
  const minYear = new Date().getFullYear() - options.periodYears - 1;

  const jobId = ctx?.jobId;
  let jobStages: ReportJobStage[] = [];
  if (jobId) {
    const existingJob = await getReportJob(supabase, jobId, userId);
    if (existingJob) jobStages = existingJob.stages;
  }

  async function pushJobStages() {
    if (jobId) await updateReportJobStages(supabase, jobId, jobStages);
  }

  async function stage<T>(key: string, label: string, fn: () => Promise<T>, skipped = false): Promise<T | null> {
    if (jobId) {
      jobStages = syncJobStages(jobStages, key, skipped ? "skipped" : "running");
      await pushJobStages();
    }
    if (skipped) {
      stages.push({ key, label, status: "skipped", detail: "Not selected for this report.", completedAt: new Date().toISOString() });
      if (jobId) {
        jobStages = syncJobStages(jobStages, key, "skipped");
        await pushJobStages();
      }
      return null;
    }
    try {
      const value = await fn();
      stages.push({ key, label, status: "completed", completedAt: new Date().toISOString() });
      if (jobId) {
        jobStages = syncJobStages(jobStages, key, "completed");
        await pushJobStages();
      }
      return value;
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220);
      stages.push({ key, label, status: "failed", detail, completedAt: new Date().toISOString() });
      if (jobId) {
        jobStages = syncJobStages(jobStages, key, "failed", detail);
        await pushJobStages();
      }
      return null;
    }
  }

  const metadata = await stage("resolve", "Resolved company identity", () => getCompanyMetadata(supabase, symbol));
  const financialPreview = await supabase
    .from("company_financials")
    .select("period_type, fiscal_year, fiscal_period, statement_type, reported_date, source_type, source_url, confidence, updated_at, data")
    .eq("ticker", symbol)
    .order("reported_date", { ascending: false })
    .limit(40);
  const finRows = (financialPreview.data ?? []) as FinancialRow[];
  const latestFinLabel = latestFinancialLabel(finRows);

  const resolution = validateCompanyResolution(symbol, metadata, latestFinLabel);
  if (!resolution.ok) {
    throw new Error(resolution.error);
  }
  const resolved = resolution.resolved;

  const freshQuote = await stage("quote", "Refreshed market price", () => refreshQuote(symbol));
  await stage("history", "Loaded historical price data", () => refreshHistory(symbol), !options.include.pricePerformance);
  const liveTechnicals = await stage(
    "technicals",
    "Calculated price performance",
    () => refreshTechnicals(symbol),
    !options.include.pricePerformance
  );
  const fundamentals = await stage(
    "financials",
    "Loaded financial statements",
    () => populateAllFundamentals(symbol, { maxFilings: options.depth === "full" ? 3 : 1 }),
    !options.include.financials && !options.include.valuation && !options.include.dividends
  );
  await stage("ratios", "Calculated valuation metrics", () => refreshRatios(supabase, symbol), !options.include.valuation);
  const filings = await stage(
    "filings",
    "Retrieved official PSX filings",
    () => getCompanyFilings(symbol, options.depth === "full" ? 30 : 12),
    !options.include.filings
  );
  const freshNews = await stage(
    "news",
    "Filtering verified company news",
    () => fetchFreshCompanyNews(symbol, resolved.companyName, resolved.sector),
    !options.include.news
  );

  const [quoteRes, financialsRes, payoutsRes, storedNewsRes, portfolio, userDividends, technicalsFallback, ratios] =
    await Promise.all([
      supabase
        .from("market_quotes")
        .select("ticker, price, prev_close, day_change, day_change_pct, volume, as_of, provider, is_realtime, last_fetched_at")
        .eq("ticker", symbol)
        .maybeSingle(),
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
        .limit(20),
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

  const normalizedFin = normalizeFinancialRows(financials, minYear);
  await stage("periods", "Normalized financial periods", async () => normalizedFin, !options.include.financials);

  const peerRows = options.include.peers
    ? await stage("peers", "Compared peers", () =>
        buildPeerRows(supabase, symbol, resolved.sector, resolved.metadata.marketCap, options.peers)
      )
    : null;

  const newsContext = buildCompanyContext(symbol, resolved.companyName, resolved.sector);
  const rawNews = [
    ...(freshNews ?? []).map((n) => ({
      title: n.title,
      url: n.url,
      source: n.source,
      publishedAt: n.publishedAt,
      snippet: n.snippet,
      provider: n.provider,
    })),
    ...storedNews.map((n) => ({
      title: n.title,
      url: n.url,
      source: n.source,
      publishedAt: n.published_at,
      summary: n.ai_summary,
      snippet: n.snippet,
      relevanceScore: n.relevance_score,
      category: n.category,
      provider: "stored",
    })),
  ];
  const filteredNews = options.include.news
    ? filterAndDedupeNews(rawNews, newsContext, 0.45, 14, options.newsPeriodDays)
    : [];
  const { officialFilings, independentNews, sectorNews } = separateFilingsFromNews(
    filteredNews,
    (filings ?? []).map((f) => ({ title: f.title, url: f.url, date: f.date, category: f.category }))
  );

  const portfolioSlice = buildPortfolioSlice(holding, portfolio, quote?.price ?? null, userDividends);
  const portfolioChart = options.include.portfolio
    ? await stage("portfolio", "Built portfolio analysis", () => buildTransactionMarkers(supabase, userId, symbol))
    : null;

  const priceChart = await stage(
    "charts",
    "Rendering charts",
    () => buildPriceChartWithBenchmark(supabase, symbol, technicals.history, options.periodYears),
    !options.include.pricePerformance
  );

  const sourceRegister = buildSourceRegister({
    symbol,
    quote,
    technicalsSource: technicals.meta.source,
    financials,
    filings: filings ?? [],
    payouts,
    news: independentNews,
  });

  const evidence = {
    generatedAt: new Date().toISOString(),
    options,
    company: {
      ticker: symbol,
      companyName: resolved.companyName,
      sector: resolved.sector,
      exchange: resolved.exchange,
      currency: resolved.currency,
      latestReportingPeriod: latestFinLabel,
      description: resolved.metadata.description,
      businessLines: resolved.metadata.businessLines,
      marketCap: resolved.metadata.marketCap,
    },
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
    financials: summarizeFinancialsForEvidence(normalizedFin.all),
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
    officialFilings,
    independentNews,
    sectorNews,
    filings: filings ?? [],
    news: independentNews,
    portfolio: portfolioSlice,
    peers: peerRows ?? [],
    refreshResult: fundamentals,
    stages,
    sourceRegister,
    displayUnit: normalizedFin.displayUnit,
  };

  const peerMedianPe = peerRows ? peerMedian(peerRows, "P/E") : null;
  const scenarios = options.include.scenarioAnalysis
    ? buildScenarioAnalysis(
        symbol,
        latestAnnualEps(normalizedFin.all),
        latestAnnualRevenue(normalizedFin.all),
        extractGrossMargin(ratios),
        extractPe(ratios),
        peerMedianPe
      )
    : [];

  const title = `${options.depth === "full" ? "Full Equity Research Report" : "Investment Brief"} — ${symbol}`;
  const { narrative, model } = await stage("narrative", "Writing sourced interpretation", () =>
    generateAiNarrative(symbol, evidence, options)
  ) ?? { narrative: emptyNarrative(), model: "none" };

  const dataTimestamps = {
    marketPrice: quote?.last_fetched_at ?? quote?.as_of ?? null,
    financialFilings: latestDate(financials.map((f) => f.updated_at)),
    news: latestDate(independentNews.map((n) => n.publishedAt)),
    portfolio: portfolio ? new Date().toISOString() : null,
  };

  const parentId = ctx?.parentReportId;
  let reportVersion = 1;
  let previousForDiff: CompanyReportPayload | null = ctx?.previousPayload ?? null;
  if (parentId) {
    const { data: parentRow } = await supabase.from("ai_briefings").select("meta").eq("id", parentId).maybeSingle();
    const parentMeta = parentRow?.meta as { reportVersion?: number; reportPayload?: CompanyReportPayload } | undefined;
    reportVersion = (parentMeta?.reportVersion ?? 1) + 1;
    previousForDiff = parentMeta?.reportPayload ?? previousForDiff;
  }

  const payload: CompanyReportPayload = {
    generatedAt: evidence.generatedAt,
    reportVersion,
    title,
    ticker: symbol,
    options,
    displayUnit: normalizedFin.displayUnit,
    evidence: evidence as unknown as Record<string, unknown>,
    narrative,
    charts: {
      price: priceChart ?? [],
      financialsAnnual: toChartSeries(normalizedFin.annual),
      financialsQuarterly: toChartSeries(normalizedFin.quarterly),
      financialsCumulative: toChartSeries(normalizedFin.cumulative),
      valuation: valuationChartSeries(ratios, peerRows ?? []),
      dividends: payoutSeries(payouts),
      peers: buildPeerChartData(peerRows ?? []),
      portfolio: portfolioChart ?? undefined,
    },
    scenarios,
    sources: sourceRegister,
    validation: { passed: true, criticalFailures: [], warnings: [], moduleChecks: [] },
    dataTimestamps,
    parentReportId: parentId ?? null,
    versionDiff: computeReportDiff(previousForDiff, {
      generatedAt: evidence.generatedAt,
      reportVersion,
      title,
      ticker: symbol,
      options,
      displayUnit: normalizedFin.displayUnit,
      evidence: evidence as unknown as Record<string, unknown>,
      narrative,
      charts: {
        price: priceChart ?? [],
        financialsAnnual: toChartSeries(normalizedFin.annual),
        financialsQuarterly: toChartSeries(normalizedFin.quarterly),
        financialsCumulative: toChartSeries(normalizedFin.cumulative),
        valuation: valuationChartSeries(ratios, peerRows ?? []),
        dividends: payoutSeries(payouts),
        peers: buildPeerChartData(peerRows ?? []),
      },
      scenarios,
      sources: sourceRegister,
      validation: { passed: true, criticalFailures: [], warnings: [], moduleChecks: [] },
      dataTimestamps,
    }),
  };

  payload.validation = validateReportBeforePublish(payload, options, dataTimestamps.marketPrice);
  assertPublishable(payload.validation);

  await stage("validation", "Validating citations", async () => payload.validation);

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
        reportVersion,
        parentReportId: parentId ?? null,
        options,
        generatedAt: evidence.generatedAt,
        startedAt,
        stages,
        reportPayload: payload,
        dataAsOf: dataTimestamps,
        dataTimestamps,
        sources: sourceRegister,
        validation: payload.validation,
        versionDiff: payload.versionDiff,
      },
    })
    .select("id, title, content, created_at, model, meta")
    .single();
  if (error) throw error;

  await stage("export", "Preparing export", async () => ({ saved: true }));

  if (jobId) await completeReportJob(supabase, jobId, saved.id as string, jobStages);

  return {
    message: `${title} generated using refreshed market data, filings, financials, payouts and verified news.`,
    result: saved,
    stages,
    payload,
  };
}

export async function startReportJob(
  supabase: SupabaseClient,
  userId: string,
  ticker: string,
  options: Partial<CompanyReportOptions>,
  parentReportId?: string | null
): Promise<string> {
  const normalized = normalizeCompanyReportOptions(options);
  return createReportJob(supabase, userId, ticker, normalized, parentReportId);
}

export async function runReportJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string
): Promise<void> {
  const { data: job } = await supabase.from("company_report_jobs").select("*").eq("id", jobId).eq("user_id", userId).single();
  if (!job) throw new Error("Job not found");

  let previousPayload: CompanyReportPayload | undefined;
  if (job.parent_report_id) {
    const { data: parent } = await supabase.from("ai_briefings").select("meta").eq("id", job.parent_report_id).maybeSingle();
    previousPayload = (parent?.meta as { reportPayload?: CompanyReportPayload })?.reportPayload;
  }

  try {
    await generateCompanyReport(supabase, userId, job.ticker, job.options as CompanyReportOptions, {
      jobId,
      parentReportId: job.parent_report_id,
      previousPayload,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stages = (job.stages as ReportJobStage[]) ?? [];
    await failReportJob(supabase, jobId, message, stages);
    throw err;
  }
}

export async function getReportPreview(
  supabase: SupabaseClient,
  userId: string,
  ticker: string
): Promise<{
  resolvable: boolean;
  error?: string;
  ticker: string;
  companyName?: string;
  sector?: string;
  exchange?: string;
  price?: number | null;
  priceUpdated?: string | null;
  financialsThrough?: string | null;
  portfolioShares?: number | null;
  filingsAvailable?: boolean;
  financialHistorySufficient?: boolean;
  suggestedPeers?: string[];
}> {
  const symbol = ticker.toUpperCase().trim();
  const metadata = await getCompanyMetadata(supabase, symbol);
  const { data: fin } = await supabase
    .from("company_financials")
    .select("period_type, fiscal_year, fiscal_period, statement_type, reported_date, data")
    .eq("ticker", symbol)
    .order("reported_date", { ascending: false })
    .limit(20);
  const finRows = (fin ?? []) as FinancialRow[];
  const latestFinLabel = latestFinancialLabel(finRows);
  const resolution = validateCompanyResolution(symbol, metadata, latestFinLabel);

  const { data: quote } = await supabase
    .from("market_quotes")
    .select("price, as_of, last_fetched_at")
    .eq("ticker", symbol)
    .maybeSingle();
  const { data: holding } = await supabase
    .from("holdings")
    .select("quantity")
    .eq("user_id", userId)
    .eq("ticker", symbol)
    .gt("quantity", 0)
    .maybeSingle();
  const filings = await getCompanyFilings(symbol, 1);
  const suggestedPeers = await autoSelectPeers(supabase, symbol, metadata.sector, metadata.marketCap);

  if (!resolution.ok) {
    return { resolvable: false, error: resolution.error, ticker: symbol, suggestedPeers };
  }

  const annualCount = finRows.filter((r) => r.statement_type === "income_statement").length;
  return {
    resolvable: true,
    ticker: symbol,
    companyName: resolution.resolved.companyName,
    sector: resolution.resolved.sector,
    exchange: resolution.resolved.exchange,
    price: quote?.price ?? null,
    priceUpdated: quote?.last_fetched_at ?? quote?.as_of ?? null,
    financialsThrough: latestFinLabel,
    portfolioShares: holding?.quantity ?? null,
    filingsAvailable: (filings?.length ?? 0) > 0,
    financialHistorySufficient: annualCount >= 2,
    suggestedPeers,
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
- Do not reveal hidden reasoning or chain-of-thought.
- Provide company-specific analysis, not generic filler.`;

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
      `{"businessOverview":[],"executiveSummary":[],"financialPerformance":[],"financialQuality":[],"valuation":[],"dividends":[],"pricePerformance":[],"catalysts":[],"risks":[],"recentDevelopments":[],"portfolio":[],"monitoring":[],"dataGaps":[]}`,
      "Populate sections requested in options.include only. Keep each text under 36 words.",
      "Structured evidence:",
      JSON.stringify(compactEvidenceForAi(evidence), null, 2),
    ].join("\n"),
    options.depth === "full" ? 2800 : 1600
  );

  return { narrative: normalizeNarrative(data), model };
}

function emptyNarrative(): AiReportNarrative {
  return normalizeNarrative({});
}

function compactEvidenceForAi(evidence: unknown): unknown {
  const e = evidence as Record<string, unknown>;
  return {
    company: e.company,
    quote: e.quote,
    technicals: e.technicals,
    financials: (e.financials as unknown[])?.slice(0, 16),
    ratios: (e.ratios as unknown[])?.slice(0, 50),
    payouts: (e.payouts as unknown[])?.slice(0, 12),
    officialFilings: (e.officialFilings as unknown[])?.slice(0, 12),
    independentNews: (e.independentNews as unknown[])?.slice(0, 10),
    portfolio: e.portfolio,
    peers: (e.peers as unknown[])?.slice(0, 5),
    sourceRegister: e.sourceRegister,
    displayUnit: e.displayUnit,
  };
}

function buildPortfolioSlice(
  holding: EnrichedHolding | null,
  portfolio: Awaited<ReturnType<typeof getPortfolio>> | null,
  currentPrice: number | null,
  userDividends: CompanyDividendRow[]
) {
  if (!holding) return { held: false };
  const dividendTotal = userDividends.reduce((s, d) => s + (d.perShare ?? 0) * holding.quantity, 0);
  const costBasis = holding.avg_cost * holding.quantity;
  const marketValue = holding.market_value ?? holding.quantity * (currentPrice ?? holding.latest_price ?? 0);
  const totalReturn = costBasis > 0 ? ((marketValue + dividendTotal - costBasis) / costBasis) * 100 : null;
  const yieldOnCost = holding.avg_cost > 0 && dividendTotal > 0 ? (dividendTotal / costBasis) * 100 : null;
  return {
    held: true,
    quantity: holding.quantity,
    avgCost: holding.avg_cost,
    currentPrice,
    marketValue,
    unrealizedPl: holding.unrealized_pl,
    unrealizedPlPct: holding.unrealized_pl_pct,
    dividendIncome: holding.dividend_income,
    weight: holding.weight,
    sectorWeight: portfolio?.sectorWeights.find((s) => s.sector === holding.sector)?.weight ?? null,
    totalReturn,
    yieldOnCost,
  };
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

function valuationChartSeries(
  rows: RatioRow[],
  peers: Awaited<ReturnType<typeof buildPeerRows>>
): CompanyReportPayload["charts"]["valuation"] {
  const names = ["P/E", "P/B", "P/S", "EV/EBITDA", "Dividend yield (TTM)"];
  return names.map((name) => {
    const row = rows.find((r) => r.ratio_name === name);
    return {
      name,
      value: row?.ratio_value ?? null,
      peerMedian: peerMedian(peers, name),
      historicalMedian: null,
    };
  });
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

function payoutSeries(rows: PayoutRow[]): CompanyReportPayload["charts"]["dividends"] {
  return rows
    .map((r) => ({ date: r.announcement_date ?? r.book_closure_start, dps: r.dividend_per_share, kind: r.kind }))
    .filter((r) => r.date || r.dps !== null)
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")))
    .slice(-12);
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

  await Promise.allSettled(feedJobs);

  return out.sort((a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt)).slice(0, 12);
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
  const sources: ReportSource[] = [];
  sources.push({
    id: "S1",
    label: `Latest market quote for ${input.symbol} from ${input.quote?.provider ?? "market provider"}`,
    asOf: input.quote?.last_fetched_at ?? input.quote?.as_of ?? null,
    publisher: input.quote?.provider ?? null,
  });
  sources.push({ id: "S2", label: `Historical PSX price data from ${input.technicalsSource ?? "PSX DPS"}` });

  const financialUrls = [...new Set(input.financials.map((f) => f.source_url).filter((u): u is string => !!u))].slice(0, 8);
  financialUrls.forEach((url, index) =>
    sources.push({ id: `S${sources.length + 1}`, label: `Financial statement extract ${index + 1}`, url })
  );
  if (!financialUrls.length && input.financials.length) {
    sources.push({ id: `S${sources.length + 1}`, label: "Structured financial rows from company_financials" });
  }

  if (input.payouts.length) {
    sources.push({ id: `S${sources.length + 1}`, label: "Official PSX payout history", asOf: latestDate(input.payouts.map((p) => p.updated_at)) });
  }

  input.filings.slice(0, 10).forEach((f) =>
    sources.push({ id: `S${sources.length + 1}`, label: `Official PSX filing: ${f.title}`, url: f.url, asOf: f.date })
  );
  input.news.slice(0, 10).forEach((n) =>
    sources.push({
      id: `S${sources.length + 1}`,
      label: `Independent news: ${n.title}`,
      url: n.url,
      asOf: n.publishedAt,
      publisher: n.source,
    })
  );
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
