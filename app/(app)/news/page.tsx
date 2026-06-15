import type { ReactNode } from "react";
import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { NewsCard } from "@/components/news-card";
import { ActionButton } from "@/components/action-button";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge, sentimentVariant } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Activity,
  Bookmark,
  Clock3,
  EyeOff,
  Filter,
  Layers3,
  Newspaper,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NewsArticle } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = {
  ticker?: string;
  sector?: string;
  sentiment?: string;
  relevance?: string;
  window?: string;
  view?: string;
  date?: string;
};

type ActiveFilter = {
  label: string;
  value: string;
  href: string;
};

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const relevanceMode = sp.relevance ?? (sp.view ? "all" : "portfolio");

  let query = supabase
    .from("news_articles")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(80);

  if (sp.ticker) query = query.eq("ticker", sp.ticker);
  if (sp.sector) query = query.eq("sector", sp.sector);
  if (sp.sentiment) query = query.eq("sentiment", sp.sentiment);
  if (relevanceMode === "portfolio") query = query.eq("low_confidence", false).or("relevance_score.gte.4,relevance_score.is.null");
  else if (relevanceMode === "low") query = query.eq("low_confidence", true);
  else if (relevanceMode !== "all") {
    const minimumRelevance = parseInt(relevanceMode, 10);
    if (Number.isFinite(minimumRelevance)) query = query.gte("relevance_score", minimumRelevance);
  }
  if (sp.view === "saved") query = query.eq("saved", true);
  else if (sp.view === "ignored") query = query.eq("ignored", true);
  else if (relevanceMode !== "low") query = query.eq("ignored", false);
  if (sp.window) {
    const hours = sp.window === "24h" ? 24 : sp.window === "7d" ? 24 * 7 : 24 * 30;
    // eslint-disable-next-line react-hooks/purity -- server component; wall-clock time is the filter input
    query = query.gte("created_at", new Date(Date.now() - hours * 3600000).toISOString());
  }

  const [holdingsRes, overviewRes, articlesRes] = await Promise.all([
    supabase
      .from("holdings")
      .select("ticker, sector")
      .eq("user_id", user.id)
      .order("ticker"),
    supabase
      .from("news_articles")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300),
    query,
  ]);

  const holdings = holdingsRes.data ?? [];
  const tickers = [...new Set(holdings.map((h) => h.ticker))];
  const sectors = [...new Set(holdings.map((h) => h.sector).filter(Boolean))] as string[];
  const articles = (articlesRes.data ?? []) as NewsArticle[];
  const overviewArticles = (overviewRes.data ?? []) as NewsArticle[];
  const activeArticles = overviewArticles.filter((a) => !a.ignored);
  const portfolioSignals = activeArticles.filter(isPortfolioRelevant);
  const highRelevanceArticles = activeArticles.filter((a) => (a.relevance_score ?? 0) >= 7 && !a.low_confidence);
  const savedArticles = overviewArticles.filter((a) => a.saved);
  const lowConfidenceArticles = overviewArticles.filter((a) => a.low_confidence || (a.relevance_score !== null && a.relevance_score <= 3));
  const negativeArticles = activeArticles.filter((a) => a.sentiment === "negative");
  const reviewQueue = activeArticles
    .filter((a) => a.review_question || a.thesis_impact || a.why_it_matters)
    .slice(0, 4);
  const leadArticle =
    articles.find((a) => (a.relevance_score ?? 0) >= 7 && !a.low_confidence && !a.ignored) ??
    articles.find((a) => !a.low_confidence && !a.ignored) ??
    articles[0] ??
    null;

  const sentimentRows = [
    { label: "Positive", count: countWhere(activeArticles, (a) => a.sentiment === "positive"), color: "bg-emerald-500" },
    { label: "Neutral", count: countWhere(activeArticles, (a) => a.sentiment === "neutral" || !a.sentiment), color: "bg-zinc-300" },
    { label: "Negative", count: negativeArticles.length, color: "bg-red-500" },
  ];
  const sentimentTotal = Math.max(1, sentimentRows.reduce((sum, row) => sum + row.count, 0));
  const tickerCoverage = tickers
    .map((ticker) => {
      const rows = activeArticles.filter((a) => a.ticker === ticker);
      return {
        ticker,
        total: rows.length,
        high: rows.filter((a) => (a.relevance_score ?? 0) >= 7 && !a.low_confidence).length,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total || a.ticker.localeCompare(b.ticker))
    .slice(0, 8);
  const topCategories = Object.entries(
    activeArticles.reduce<Record<string, number>>((acc, article) => {
      const key = article.category && article.category !== "general" ? formatCategory(article.category) : "general";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const filterHref = (patch: Partial<Search>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `/news?${qs}` : "/news";
  };

  const filterChip = (patch: Partial<Search>, label: string, active: boolean) => (
    <Link
      key={`${label}-${JSON.stringify(patch)}`}
      href={filterHref(patch)}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {label}
    </Link>
  );

  const activeFilters = buildActiveFilters(sp, relevanceMode, filterHref);
  const hasFilters = activeFilters.length > 0;
  const relevanceLabel = describeRelevance(relevanceMode);
  const dateGroups = groupArticlesByDate(articles);
  const selectedDate = sp.date;
  const feedGroups = selectedDate
    ? dateGroups.filter((group) => group.date === selectedDate)
    : dateGroups;
  const shownCount = feedGroups.reduce((sum, group) => sum + group.articles.length, 0);

  return (
    <div className="space-y-5">
      <section className="rise overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.9fr)]">
          <div className="p-5 sm:p-6">
            <p className="eyebrow">PSX intelligence</p>
            <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold tracking-editorial text-foreground sm:text-4xl">News Center</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  Holding-specific news screened for portfolio relevance, source quality, sentiment, and thesis impact.
                </p>
              </div>
              <ActionButton
                endpoint="/api/news/refresh"
                label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh news</>}
                size="sm"
                className="w-full sm:w-auto"
              />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              <MetricTile icon={Target} label="Portfolio signals" value={portfolioSignals.length} sub="active matches" tone="blue" />
              <MetricTile icon={Sparkles} label="High relevance" value={highRelevanceArticles.length} sub="7+ score" tone="green" />
              <MetricTile icon={Bookmark} label="Saved" value={savedArticles.length} sub="watch later" tone="neutral" />
              <MetricTile icon={TrendingDown} label="Risk tone" value={negativeArticles.length} sub="negative reads" tone="red" />
            </div>
          </div>

          <aside className="border-t border-border bg-muted/30 p-5 lg:border-l lg:border-t-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Current view</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{articles.length}</p>
                <p className="text-xs text-muted-foreground">
                  article{articles.length === 1 ? "" : "s"} shown · {relevanceLabel}
                </p>
              </div>
              <Badge variant={hasFilters ? "blue" : "secondary"}>{hasFilters ? `${activeFilters.length} filter${activeFilters.length === 1 ? "" : "s"}` : "default"}</Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {activeFilters.length > 0 ? (
                activeFilters.map((filter) => (
                  <Link
                    key={`${filter.label}-${filter.value}`}
                    href={filter.href}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="text-foreground">{filter.label}</span>
                    {filter.value}
                    <X className="h-3 w-3" />
                  </Link>
                ))
              ) : (
                <span className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  Portfolio relevance · unignored
                </span>
              )}
            </div>

            {leadArticle && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="eyebrow">Top signal</p>
                <a
                  href={leadArticle.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block text-sm font-semibold leading-snug transition-colors hover:text-foreground/70"
                >
                  {leadArticle.title}
                </a>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {[leadArticle.ticker, leadArticle.source, formatDate(leadArticle.published_at)].filter(Boolean).join(" · ")}
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>

      <Card className="rise rise-1">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Refine feed
            </CardTitle>
            <CardDescription>Ticker, sector, sentiment, relevance, time window, and archive state.</CardDescription>
          </div>
          {hasFilters && (
            <Link
              href="/news"
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </Link>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterGroup icon={Target} label="Relevance">
            {filterChip({ relevance: "portfolio" }, "Portfolio", relevanceMode === "portfolio")}
            {filterChip({ relevance: "7" }, "High 7+", relevanceMode === "7")}
            {filterChip({ relevance: "low" }, "Low confidence", relevanceMode === "low")}
            {filterChip({ relevance: "all" }, "All", relevanceMode === "all")}
          </FilterGroup>

          <FilterGroup icon={Activity} label="Sentiment">
            {filterChip({ sentiment: undefined }, "Any", !sp.sentiment)}
            {["positive", "neutral", "negative"].map((sentiment) =>
              filterChip({ sentiment }, sentiment, sp.sentiment === sentiment)
            )}
          </FilterGroup>

          <FilterGroup icon={Clock3} label="Window">
            {filterChip({ window: undefined }, "Any time", !sp.window)}
            {filterChip({ window: "24h" }, "24h", sp.window === "24h")}
            {filterChip({ window: "7d" }, "7d", sp.window === "7d")}
            {filterChip({ window: "30d" }, "30d", sp.window === "30d")}
          </FilterGroup>

          <FilterGroup icon={Layers3} label="State">
            {filterChip({ view: undefined }, "Active", !sp.view)}
            {filterChip({ view: "saved" }, "Saved", sp.view === "saved")}
            {filterChip({ view: "ignored" }, "Ignored", sp.view === "ignored")}
          </FilterGroup>

          {tickers.length > 0 && (
            <FilterGroup icon={Search} label="Ticker">
              {filterChip({ ticker: undefined }, "All", !sp.ticker)}
              {tickers.map((ticker) => filterChip({ ticker }, ticker, sp.ticker === ticker))}
            </FilterGroup>
          )}

          {sectors.length > 0 && (
            <FilterGroup icon={Filter} label="Sector">
              {filterChip({ sector: undefined }, "All", !sp.sector)}
              {sectors.map((sector) => filterChip({ sector }, sector, sp.sector === sector))}
            </FilterGroup>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Feed</p>
              <h2 className="text-lg font-semibold tracking-editorial">Datewise news timeline</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              {articles.length === 80 && !selectedDate
                ? "Showing latest 80 matches"
                : `${shownCount} match${shownCount === 1 ? "" : "es"}`}
            </p>
          </div>

          {dateGroups.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-foreground">Browse by date</p>
                {selectedDate && (
                  <Link href={filterHref({ date: undefined })} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                    Show all dates
                  </Link>
                )}
              </div>
              <div className="scroll-touch flex gap-2 overflow-x-auto pb-1">
                <Link
                  href={filterHref({ date: undefined })}
                  className={cn(
                    "inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    !selectedDate
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  All dates
                  <span className={cn("ml-2 rounded-full px-1.5 py-0.5 text-[10px]", !selectedDate ? "bg-white/15 text-white" : "bg-muted text-muted-foreground")}>
                    {articles.length}
                  </span>
                </Link>
                {dateGroups.map((group) => (
                  <Link
                    key={group.date}
                    href={filterHref({ date: group.date })}
                    className={cn(
                      "inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                      selectedDate === group.date
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {formatDateTab(group.date)}
                    <span className={cn("ml-2 rounded-full px-1.5 py-0.5 text-[10px]", selectedDate === group.date ? "bg-white/15 text-white" : "bg-muted text-muted-foreground")}>
                      {group.articles.length}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {articles.length === 0 || feedGroups.length === 0 ? (
            <EmptyState
              icon={Newspaper}
              title={selectedDate ? "No news for this date" : relevanceMode === "portfolio" ? "No portfolio-relevant news shown" : "No matching news"}
              description={
                tickers.length === 0
                  ? "Import holdings first, then refresh news to start monitoring your portfolio."
                  : selectedDate
                    ? "Choose another date tab or clear the date filter to return to the full timeline."
                  : hasFilters
                    ? "No stored articles match the current filters."
                    : "Refresh news to search Pakistani business news for every position."
              }
              action={
                tickers.length === 0 ? (
                  <Link href="/import"><Button>Go to Import Center</Button></Link>
                ) : selectedDate ? (
                  <Link href={filterHref({ date: undefined })}><Button variant="outline">Show all dates</Button></Link>
                ) : hasFilters ? (
                  <Link href="/news"><Button variant="outline">Clear filters</Button></Link>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-5">
              {feedGroups.map((group) => (
                <section key={group.date} className="space-y-3">
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                    <div>
                      <p className="text-sm font-semibold">{formatDateHeading(group.date)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {group.articles.length} article{group.articles.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge variant="secondary">{group.date}</Badge>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {group.articles.map((article) => (
                      <NewsCard key={article.id} article={article} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4" /> Signal mix
              </CardTitle>
              <CardDescription>Sentiment and topic mix across active stored articles.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                {sentimentRows.map((row) => (
                  <div key={row.label} className={row.color} style={{ width: `${(row.count / sentimentTotal) * 100}%` }} />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {sentimentRows.map((row) => (
                  <div key={row.label}>
                    <p className="text-base font-semibold tabular-nums">{row.count}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{row.label}</p>
                  </div>
                ))}
              </div>
              {topCategories.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {topCategories.map(([category, count]) => (
                    <div key={category} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-muted-foreground">{category}</span>
                      <span className="font-semibold tabular-nums">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-4 w-4" /> Portfolio coverage
              </CardTitle>
              <CardDescription>Most-covered holdings in the stored feed.</CardDescription>
            </CardHeader>
            <CardContent>
              {tickerCoverage.length > 0 ? (
                <div className="space-y-2.5">
                  {tickerCoverage.map((row) => (
                    <div key={row.ticker} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <Link href={filterHref({ ticker: row.ticker })} className="font-semibold hover:underline">
                          {row.ticker}
                        </Link>
                        <span className="text-muted-foreground">
                          {row.total} article{row.total === 1 ? "" : "s"}
                          {row.high > 0 ? ` · ${row.high} high` : ""}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, row.total * 12)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {tickers.length === 0 ? "No holdings imported yet." : "No coverage for current holdings yet."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Review queue
              </CardTitle>
              <CardDescription>Articles with AI-generated portfolio prompts.</CardDescription>
            </CardHeader>
            <CardContent>
              {reviewQueue.length > 0 ? (
                <div className="space-y-3">
                  {reviewQueue.map((article) => (
                    <a key={article.id} href={article.url} target="_blank" rel="noopener noreferrer" className="block border-b border-border pb-3 last:border-b-0 last:pb-0">
                      <div className="mb-1 flex items-center gap-1.5">
                        {article.ticker && <Badge variant="outline">{article.ticker}</Badge>}
                        <Badge variant={sentimentVariant(article.sentiment)}>{article.sentiment ?? "unrated"}</Badge>
                      </div>
                      <p className="line-clamp-2 text-xs font-semibold leading-relaxed hover:underline">{article.title}</p>
                      {(article.review_question || article.thesis_impact) && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                          {article.review_question ?? article.thesis_impact}
                        </p>
                      )}
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No AI review prompts in the active feed.</p>
              )}
            </CardContent>
          </Card>

          {lowConfidenceArticles.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardContent className="flex items-start gap-3 p-4">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">{lowConfidenceArticles.length} low-confidence matches</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    Audit weak ticker or company-name matches before relying on them in portfolio reviews.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function FilterGroup({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[8.25rem_minmax(0,1fr)]">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="scroll-touch flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {children}
      </div>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sub: string;
  tone: "blue" | "green" | "red" | "neutral";
}) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "blue" && "text-blue-600",
            tone === "green" && "text-emerald-600",
            tone === "red" && "text-red-600",
            tone === "neutral" && "text-muted-foreground"
          )}
        />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function buildActiveFilters(sp: Search, relevanceMode: string, filterHref: (patch: Partial<Search>) => string): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (sp.ticker) filters.push({ label: "Ticker", value: sp.ticker, href: filterHref({ ticker: undefined }) });
  if (sp.sector) filters.push({ label: "Sector", value: sp.sector, href: filterHref({ sector: undefined }) });
  if (sp.sentiment) filters.push({ label: "Sentiment", value: sp.sentiment, href: filterHref({ sentiment: undefined }) });
  if (sp.window) filters.push({ label: "Window", value: sp.window, href: filterHref({ window: undefined }) });
  if (sp.view) filters.push({ label: "State", value: sp.view, href: filterHref({ view: undefined }) });
  if (sp.date) filters.push({ label: "Date", value: sp.date, href: filterHref({ date: undefined }) });
  if (sp.relevance && relevanceMode !== "portfolio") {
    filters.push({ label: "Relevance", value: describeRelevance(relevanceMode), href: filterHref({ relevance: undefined }) });
  }
  return filters;
}

function isPortfolioRelevant(article: NewsArticle): boolean {
  return !article.low_confidence && (article.relevance_score === null || article.relevance_score >= 4);
}

function countWhere(articles: NewsArticle[], predicate: (article: NewsArticle) => boolean): number {
  return articles.reduce((count, article) => count + (predicate(article) ? 1 : 0), 0);
}

function describeRelevance(value: string): string {
  if (value === "portfolio") return "portfolio relevance";
  if (value === "7") return "high relevance";
  if (value === "low") return "low confidence";
  return "all relevance";
}

function formatCategory(category: string): string {
  return category.replace(/_/g, " ");
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function articleDateKey(article: NewsArticle): string {
  return String(article.published_at ?? article.created_at).slice(0, 10);
}

function groupArticlesByDate(articles: NewsArticle[]): { date: string; articles: NewsArticle[] }[] {
  const groups = new Map<string, NewsArticle[]>();
  for (const article of articles) {
    const key = articleDateKey(article);
    const existing = groups.get(key);
    if (existing) existing.push(article);
    else groups.set(key, [article]);
  }
  return [...groups.entries()]
    .map(([date, rows]) => ({
      date,
      articles: rows.sort((a, b) => articleTimestamp(b) - articleTimestamp(a)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatDateTab(date: string): string {
  const parsed = parseDateKey(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString("en-PK", { month: "short", day: "numeric" });
}

function formatDateHeading(date: string): string {
  const parsed = parseDateKey(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString("en-PK", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function parseDateKey(date: string): Date | null {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function articleTimestamp(article: NewsArticle): number {
  const value = article.published_at ?? article.created_at;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
