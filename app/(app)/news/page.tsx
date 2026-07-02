import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { NewsBriefWidget } from "@/components/news-brief-widget";
import { NewsEventCard, NewsEventRow, type TickerMoves } from "@/components/news-event-card";
import { NewsRefreshButton } from "@/components/news-refresh-button";
import { SectorChip, SectorDot } from "@/components/sector-chip";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { CalendarDays, LayoutGrid, List, Newspaper, Search } from "lucide-react";
import { cn, formatSignedPct } from "@/lib/utils";
import { getUserNewsFeed, type FeedNewsArticle } from "@/lib/news/global-store";
import { buildNewsEvents, eventMatchesSearch, type NewsEvent } from "@/lib/news/events";
import { getPortfolio } from "@/lib/portfolio";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { getCachedMarketGlobal } from "@/lib/market/read";

export const dynamic = "force-dynamic";

type SearchParams = {
  tab?: string;
  window?: string;
  q?: string;
  filter?: string;
  ticker?: string;
  view?: string;
};

type TabId = "suggested" | "market" | "companies" | "policy" | "upcoming" | "saved";
type FilterId = "owned" | "watchlist" | "suggested" | "official" | "high";

const TABS: { id: TabId; label: string }[] = [
  { id: "suggested", label: "Suggested" },
  { id: "market", label: "Market" },
  { id: "companies", label: "Companies" },
  { id: "policy", label: "Policy & Economy" },
  { id: "upcoming", label: "Upcoming" },
  { id: "saved", label: "Saved" },
];

const WINDOWS: { id: string; label: string; hours: number | null; today?: boolean }[] = [
  { id: "today", label: "Today", hours: null, today: true },
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "week", label: "This week", hours: 24 * 7 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "month", label: "This month", hours: 24 * 30 },
  { id: "all", label: "All", hours: null },
];

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "owned", label: "Owned" },
  { id: "watchlist", label: "Watchlist" },
  { id: "suggested", label: "Suggested" },
  { id: "official", label: "Official only" },
  { id: "high", label: "High importance" },
];

type UpcomingItem = {
  id: string;
  date: string;
  title: string;
  topic: string;
  relevance: string;
  href: string | null;
};

type DividendEventRow = {
  id: string;
  ticker: string | null;
  company_name: string | null;
  event_type: string | null;
  status: string | null;
  announcement_date: string | null;
  ex_date: string | null;
  payment_date: string | null;
  estimated_payment_start: string | null;
  estimated_payment_end: string | null;
  source_url: string | null;
  is_forecast: boolean | null;
};

type MarketEventRow = {
  ticker: string | null;
  company_name: string | null;
  sector: string | null;
  event_type: string;
  title: string;
  source_url: string | null;
  event_date: string;
  event_time: string | null;
};

export default async function NewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? "suggested") as TabId;
  const windowId = WINDOWS.find((w) => w.id === sp.window)?.id ?? "week";
  const activeFilter = FILTERS.find((f) => f.id === sp.filter)?.id ?? null;
  const query = sp.q?.trim() ?? "";
  const activeTicker = sp.ticker?.trim().toUpperCase() || null;
  const view: "cards" | "compact" = sp.view === "compact" ? "compact" : "cards";
  const todayKey = pktDateKey(new Date());

  const [portfolio, articles, briefRes, watchlistRes, sourceRes, dividendEventsRes, marketEventsRes, dailyPerformance, marketGlobal] = await Promise.all([
    getPortfolio(supabase, user.id),
    getUserNewsFeed(supabase, user.id, 260),
    supabase
      .from("ai_briefings")
      .select("id, content, model, created_at")
      .eq("user_id", user.id)
      .eq("briefing_type", "news_brief")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("stock_watchlist").select("ticker").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("news_sources").select("enabled, health_status, last_success_at, updated_at"),
    supabase
      .from("dividend_events")
      .select("id, ticker, company_name, event_type, status, announcement_date, ex_date, payment_date, estimated_payment_start, estimated_payment_end, source_url, is_forecast")
      .eq("user_id", user.id)
      .in("status", ["announced", "expected", "forecasted", "needs_review", "overdue"])
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("market_events")
      .select("ticker, company_name, sector, event_type, title, source_url, event_date, event_time")
      .gte("event_date", todayKey)
      .order("event_date", { ascending: true })
      .limit(30),
    getDailyHoldingPerformance(supabase, user.id).catch(() => null),
    getCachedMarketGlobal().catch(() => null),
  ]);

  const holdings = portfolio.holdings.map((h) => ({
    ticker: h.ticker,
    company_name: h.company_name,
    sector: h.sector,
    weight: h.weight,
  }));
  const watchlist = [...new Set((watchlistRes.data ?? []).map((row) => String(row.ticker)))];
  const events = buildNewsEvents(articles as FeedNewsArticle[], { holdings, watchlist });
  const latestBrief = briefRes.data
    ? { content: briefRes.data.content as string, model: (briefRes.data.model as string) ?? "", createdAt: briefRes.data.created_at as string }
    : null;

  const cutoff = windowCutoff(windowId);
  const inWindow = (event: NewsEvent) => !cutoff || event.timestamp >= cutoff;
  const visibleEvents = events
    .filter((event) => !event.ignored)
    .filter((event) => (tab === "saved" ? true : inWindow(event)))
    .filter((event) => eventMatchesSearch(event, query))
    .filter((event) => filterEvent(event, activeFilter))
    .filter((event) => !activeTicker || event.affectedHoldings.includes(activeTicker));

  // Day moves per held ticker, shown on holding chips and the symbols rail.
  const moves: TickerMoves = {};
  for (const row of dailyPerformance?.rows ?? []) moves[row.ticker] = row.dayChangePct;

  // Symbols rail: holdings by portfolio weight with their visible event counts.
  const eventCountByTicker = new Map<string, number>();
  for (const event of visibleEvents) {
    for (const ticker of event.affectedHoldings) {
      eventCountByTicker.set(ticker, (eventCountByTicker.get(ticker) ?? 0) + 1);
    }
  }
  const symbolRail = [...portfolio.holdings]
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .map((h) => ({
      ticker: h.ticker,
      move: moves[h.ticker] ?? null,
      count: eventCountByTicker.get(h.ticker) ?? 0,
    }));

  // Sector pulse: today's average return for sectors represented in the portfolio.
  const portfolioSectors = new Set(holdings.map((h) => h.sector).filter((s): s is string => !!s));
  const sectorPulse = (marketGlobal?.sectors ?? [])
    .filter((s) => portfolioSectors.has(s.sector) && s.average_return !== null)
    .sort((a, b) => (b.average_return ?? 0) - (a.average_return ?? 0))
    .slice(0, 8);

  const suggested = visibleEvents.filter((event) => event.suggested && event.importance !== "Routine");
  const featured = tab === "suggested" ? suggested.find((event) => event.importance === "Critical" || event.importance === "High") ?? suggested[0] ?? null : null;
  const additionalSuggested = suggested.filter((event) => event.id !== featured?.id).slice(0, 5);

  const upcoming = buildUpcomingItems({
    dividends: (dividendEventsRes.data ?? []) as DividendEventRow[],
    marketEvents: (marketEventsRes.data ?? []) as MarketEventRow[],
    holdings,
    watchlist,
    todayKey,
  });

  const feed = eventsForTab(visibleEvents, tab)
    .filter((event) => event.id !== featured?.id)
    .slice(0, tab === "suggested" ? 30 : 60);
  const groups = groupEventsByDate(feed);
  const sourceHealth = sourceStatus(sourceRes.data ?? [], articles);
  const importantCount = suggested.filter((event) => event.importance === "Critical" || event.importance === "High").length;
  const newToday = events.filter((event) => event.dateKey === todayKey).length;
  const topicsToWatch = [...new Set(suggested.flatMap((event) => event.whatToWatch))].slice(0, 6);
  const sectors = [...new Set(holdings.map((h) => h.sector).filter((s): s is string => !!s))].slice(0, 8);

  const buildHref = (patch: Partial<SearchParams>) => {
    const merged = {
      tab,
      window: windowId,
      q: query || undefined,
      filter: activeFilter ?? undefined,
      ticker: activeTicker ?? undefined,
      view: view === "compact" ? view : undefined,
      ...patch,
    };
    const params = new URLSearchParams();
    if (merged.tab && merged.tab !== "suggested") params.set("tab", merged.tab);
    if (merged.window && merged.window !== "week") params.set("window", merged.window);
    if (merged.q) params.set("q", merged.q);
    if (merged.filter) params.set("filter", merged.filter);
    if (merged.ticker) params.set("ticker", merged.ticker);
    if (merged.view === "compact") params.set("view", merged.view);
    const qs = params.toString();
    return qs ? `/news?${qs}` : "/news";
  };

  return (
    <div className="mx-auto max-w-[1240px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className="eyebrow">PSX intelligence</p>
          <h1 className="text-2xl font-semibold tracking-editorial sm:text-3xl">News & Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Important developments suggested for you based on your holdings, watchlist, sectors, and the wider market.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{sourceHealth}</p>
        </div>
        <NewsRefreshButton />
      </header>

      {newToday > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span>{newToday} new event{newToday === 1 ? "" : "s"} available today</span>
          <div className="flex gap-2">
            <Link href={buildHref({ window: "today" })} className="text-sm font-medium hover:underline">Show events</Link>
            <Link href={buildHref({ window: "week" })} className="text-sm text-muted-foreground hover:text-foreground">Dismiss</Link>
          </div>
        </div>
      )}

      <nav className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto border-b border-border bg-background/90 px-1 backdrop-blur">
        {TABS.map((item) => {
          const active = item.id === tab;
          const label = tabLabel(item.id, { importantCount, newToday, saved: events.filter((event) => event.saved).length, upcoming: upcoming.length });
          return (
            <Link
              key={item.id}
              href={buildHref({ tab: item.id })}
              className={cn(
                "relative whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
              {label && <span className="ml-1.5 text-[11px] text-muted-foreground/70">{label}</span>}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" />}
            </Link>
          );
        })}
      </nav>

      {symbolRail.length > 0 && (
        <div className="rise -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5" role="navigation" aria-label="Filter news by holding">
          <span className="shrink-0 pr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your symbols</span>
          {symbolRail.map((item) => {
            const active = activeTicker === item.ticker;
            return (
              <Link
                key={item.ticker}
                href={buildHref({ ticker: active ? undefined : item.ticker })}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-foreground/50 bg-muted font-medium text-foreground"
                    : "border-border text-foreground/80 hover:border-foreground/30 hover:text-foreground"
                )}
                title={active ? `Clear ${item.ticker} filter` : `Show news for ${item.ticker}`}
              >
                <span className="font-medium">{item.ticker}</span>
                {typeof item.move === "number" && (
                  <span className={cn("tabular-nums", item.move > 0 ? "text-emerald-700" : item.move < 0 ? "text-red-700" : "text-muted-foreground")}>
                    {formatSignedPct(item.move)}
                  </span>
                )}
                {item.count > 0 && <span className="text-[11px] text-muted-foreground">{item.count}</span>}
              </Link>
            );
          })}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-card p-0.5">
            {WINDOWS.map((window) => (
              <Link
                key={window.id}
                href={buildHref({ window: window.id })}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  windowId === window.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {window.label}
              </Link>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
          <form action="/news" className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input type="hidden" name="tab" value={tab === "suggested" ? "" : tab} />
            <input type="hidden" name="window" value={windowId === "week" ? "" : windowId} />
            {activeFilter && <input type="hidden" name="filter" value={activeFilter} />}
            {activeTicker && <input type="hidden" name="ticker" value={activeTicker} />}
            {view === "compact" && <input type="hidden" name="view" value="compact" />}
            <input
              name="q"
              defaultValue={query}
              placeholder="Search events, companies, tickers or topics"
              className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </form>

          <div className="inline-flex shrink-0 rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Feed density">
            <Link
              href={buildHref({ view: undefined })}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                view === "cards" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
              title="Card view"
              aria-label="Card view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Link>
            <Link
              href={buildHref({ view: "compact" })}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                view === "compact" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
              title="Compact view"
              aria-label="Compact view"
            >
              <List className="h-3.5 w-3.5" />
            </Link>
          </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => {
            const active = activeFilter === filter.id;
            return (
              <Link
                key={filter.id}
                href={buildHref({ filter: active ? undefined : filter.id })}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {filter.label}
              </Link>
            );
          })}
          <details className="group relative">
            <summary className="cursor-pointer rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">More</summary>
            <div className="absolute left-0 top-8 z-30 w-48 rounded-lg border border-border bg-card p-2 text-xs shadow-lg">
              {["Sectors", "Mutual Funds", "Commodities", "Metals", "Crypto", "Global Markets"].map((item) => (
                <div key={item} className="rounded px-2 py-1.5 text-muted-foreground">{item}</div>
              ))}
            </div>
          </details>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-6">
          <NewsBriefWidget hasNews={events.length > 0} initialBrief={latestBrief} />

          {tab === "suggested" && (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-editorial">Suggested for you</h2>
                  <p className="text-xs text-muted-foreground">Best current event clusters based on your holdings, watchlist and portfolio sectors.</p>
                </div>
                <Link href={buildHref({ filter: "suggested" })} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  View all suggested events
                </Link>
              </div>
              {featured ? (
                <div className="rise">
                  <NewsEventCard event={featured} featured moves={moves} />
                </div>
              ) : (
                <EmptyState
                  icon={Newspaper}
                  title="No recent events meaningfully affect your holdings or watchlist."
                  description="Market events and upcoming confirmed items are still available below."
                />
              )}
              {additionalSuggested.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {additionalSuggested.map((event, index) => (
                    <div key={event.id} className={cn("rise", index < 5 && `rise-${index + 1}`)}>
                      <NewsEventCard event={event} moves={moves} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === "upcoming" ? (
            <UpcomingPanel upcoming={upcoming} large />
          ) : feed.length === 0 ? (
            <EmptyForTab tab={tab} windowId={windowId} buildHref={buildHref} />
          ) : (
            <section className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold tracking-editorial">{tab === "suggested" ? "Event feed" : TABS.find((t) => t.id === tab)?.label}</h2>
                  <p className="text-xs text-muted-foreground">Clustered events. Related reports are grouped under one primary event.</p>
                </div>
                {activeTicker && (
                  <Link
                    href={buildHref({ ticker: undefined })}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/30"
                  >
                    Showing {activeTicker} only · clear
                  </Link>
                )}
              </div>
              {groups.map((group, groupIndex) => (
                <section key={group.date} className={cn("space-y-3 rise", groupIndex < 5 && `rise-${groupIndex + 1}`)}>
                  <div className="flex items-center gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatHeading(group.date)}</h3>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  {view === "compact" ? (
                    <div className="divide-y divide-border/60 rounded-lg border border-border bg-card px-2 py-1">
                      {group.events.map((event) => (
                        <NewsEventRow key={event.id} event={event} moves={moves} />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {group.events.map((event) => (
                        <NewsEventCard key={event.id} event={event} moves={moves} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </section>
          )}
        </main>

        <aside className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          <UpcomingPanel upcoming={upcoming.slice(0, 6)} />

          {sectorPulse.length > 0 && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Sector pulse</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Today&apos;s average move in your portfolio sectors.</p>
              <div className="mt-3 space-y-1">
                {sectorPulse.map((row) => (
                  <Link
                    key={row.sector}
                    href={buildHref({ q: row.sector })}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                    title={`Search news for ${row.sector}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <SectorDot sector={row.sector} />
                      <span className="truncate text-foreground/85">{row.sector}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium tabular-nums",
                        (row.average_return ?? 0) > 0 ? "text-emerald-700" : (row.average_return ?? 0) < 0 ? "text-red-700" : "text-muted-foreground"
                      )}
                    >
                      {formatSignedPct(row.average_return)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Portfolio coverage</h2>
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="font-medium">{holdings.length}</span> owned holdings tracked</p>
              <p><span className="font-medium">{watchlist.length}</span> watchlist companies</p>
              <p><span className="font-medium">{sectors.length}</span> represented sectors</p>
            </div>
            {sectors.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {sectors.map((sector) => (
                  <Link key={sector} href={buildHref({ q: sector })} title={`Search news for ${sector}`}>
                    <SectorChip sector={sector} size="xs" className="transition-opacity hover:opacity-80" />
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Topics to watch</h2>
            {topicsToWatch.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {topicsToWatch.map((topic) => (
                  <li key={topic} className="text-sm text-foreground/85">- {topic}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No specific follow-up topics were identified from current suggested events.</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function eventsForTab(events: NewsEvent[], tab: TabId): NewsEvent[] {
  switch (tab) {
    case "suggested":
      return events.filter((event) => event.suggested);
    case "market":
      return events.filter((event) => ["market", "commodity", "forex", "crypto", "international", "geopolitics"].includes(event.category));
    case "companies":
      return events.filter((event) => event.affectedHoldings.length > 0 || ["company", "earnings", "result", "dividend", "corporate_announcement"].includes(event.category));
    case "policy":
      return events.filter((event) => ["policy", "economy", "regulatory"].includes(event.category));
    case "saved":
      return events.filter((event) => event.saved);
    case "upcoming":
      return [];
  }
}

function filterEvent(event: NewsEvent, filter: FilterId | null): boolean {
  if (!filter) return true;
  if (filter === "owned") return event.affectedHoldings.length > 0;
  if (filter === "watchlist") return event.whySuggested?.includes("watchlist") ?? false;
  if (filter === "suggested") return event.suggested;
  if (filter === "official") return event.verification === "Official";
  if (filter === "high") return event.importance === "Critical" || event.importance === "High";
  return true;
}

function groupEventsByDate(events: NewsEvent[]): { date: string; events: NewsEvent[] }[] {
  const map = new Map<string, NewsEvent[]>();
  for (const event of events) (map.get(event.dateKey) ?? map.set(event.dateKey, []).get(event.dateKey)!).push(event);
  return [...map.entries()]
    .map(([date, rows]) => ({ date, events: rows.sort((a, b) => b.timestamp - a.timestamp) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function windowCutoff(windowId: string): number | null {
  const window = WINDOWS.find((w) => w.id === windowId);
  if (!window || window.id === "all") return null;
  if (window.today) return pktStartOfToday();
  if (window.id === "month") return pktStartOfMonth();
  if (window.id === "week") return pktStartOfWeek();
  return window.hours ? Date.now() - window.hours * 3600000 : null;
}

function pktStartOfToday(): number {
  const ymd = pktDateKey(new Date());
  return new Date(`${ymd}T00:00:00+05:00`).getTime();
}

function pktStartOfMonth(): number {
  const ymd = pktDateKey(new Date());
  return new Date(`${ymd.slice(0, 8)}01T00:00:00+05:00`).getTime();
}

function pktStartOfWeek(): number {
  const now = new Date();
  const pkt = new Date(`${pktDateKey(now)}T00:00:00+05:00`);
  const day = pkt.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  pkt.setUTCDate(pkt.getUTCDate() - diff);
  return pkt.getTime();
}

function pktDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatHeading(date: string): string {
  const today = pktDateKey(new Date());
  if (date === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00+05:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === pktDateKey(yesterday)) return "Yesterday";
  const parsed = new Date(`${date}T00:00:00+05:00`);
  return parsed.toLocaleDateString("en-PK", { weekday: "long", month: "long", day: "numeric" });
}

function tabLabel(tab: TabId, counts: { importantCount: number; newToday: number; saved: number; upcoming: number }): string | null {
  if (tab === "suggested" && counts.importantCount > 0) return `${counts.importantCount} important`;
  if (tab === "market" && counts.newToday > 0) return `${counts.newToday} new`;
  if (tab === "upcoming" && counts.upcoming > 0) return `${counts.upcoming} upcoming`;
  if (tab === "saved" && counts.saved > 0) return `${counts.saved} saved`;
  return null;
}

function sourceStatus(rows: { enabled?: boolean; health_status?: string | null; last_success_at?: string | null; updated_at?: string | null }[], articles: FeedNewsArticle[]): string {
  const enabled = rows.filter((row) => row.enabled !== false);
  const healthy = enabled.filter((row) => row.health_status !== "error").length;
  const total = enabled.length || rows.length || 29;
  const latestSource = rows.map((row) => row.last_success_at ?? row.updated_at).filter((value): value is string => !!value).sort().at(-1);
  const latestArticle = articles.map((article) => article.published_at ?? article.created_at).filter((value): value is string => !!value).sort().at(-1);
  const latest = latestSource ?? latestArticle;
  return `Updated ${latest ? formatAgo(latest) : "recently"} · ${healthy || total} of ${total} sources healthy`;
}

function formatAgo(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  return date.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}

function buildUpcomingItems(input: {
  dividends: DividendEventRow[];
  marketEvents: MarketEventRow[];
  holdings: { ticker: string; sector: string | null }[];
  watchlist: string[];
  todayKey: string;
}): UpcomingItem[] {
  const owned = new Set(input.holdings.map((h) => h.ticker));
  const watch = new Set(input.watchlist);
  const items: UpcomingItem[] = [];

  for (const event of input.dividends) {
    const date = event.ex_date ?? event.payment_date ?? event.estimated_payment_start ?? event.announcement_date;
    if (!date || date < input.todayKey) continue;
    const ticker = event.ticker ?? "Portfolio";
    items.push({
      id: `dividend-${event.id}`,
      date,
      title: `${ticker} ${event.is_forecast ? "forecast payout" : event.event_type ?? "dividend event"}`,
      topic: event.company_name ?? ticker,
      relevance: owned.has(ticker) ? "Owned holding" : watch.has(ticker) ? "Watchlist" : "Portfolio income",
      href: event.source_url,
    });
  }

  for (const event of input.marketEvents) {
    const ticker = event.ticker ?? "";
    items.push({
      id: `market-${event.ticker ?? event.title}-${event.event_date}`,
      date: event.event_date,
      title: event.title,
      topic: event.company_name ?? event.sector ?? event.event_type,
      relevance: owned.has(ticker) ? "Owned holding" : watch.has(ticker) ? "Watchlist" : "Official PSX event",
      href: event.source_url,
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
}

function UpcomingPanel({ upcoming, large = false }: { upcoming: UpcomingItem[]; large?: boolean }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-4", large && "p-5")}>
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Upcoming events</h2>
      </div>
      {upcoming.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No confirmed upcoming events are available for your current filters.</p>
      ) : (
        <div className="mt-3 divide-y divide-border">
          {upcoming.map((item) => (
            <div key={item.id} className="grid grid-cols-[44px_1fr] gap-3 py-3 first:pt-0 last:pb-0">
              <div className="text-xs font-medium text-muted-foreground">{formatUpcomingDate(item.date)}</div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.topic} · {item.relevance}</p>
                {item.href && (
                  <a href={item.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium hover:underline">
                    View official source
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatUpcomingDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00+05:00`);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}

function EmptyForTab({ tab, windowId, buildHref }: { tab: TabId; windowId: string; buildHref: (patch: Partial<SearchParams>) => string }) {
  const title =
    tab === "saved"
      ? "You have not saved any events yet."
      : windowId === "today"
        ? "No events have been published today in the selected categories."
        : "No events match the current filters.";
  return (
    <EmptyState
      icon={Newspaper}
      title={title}
      description="Try a wider date range, clear filters, or refresh sources."
      action={windowId !== "all" ? <Link href={buildHref({ window: "all", filter: undefined })}><Button variant="outline">Show all time</Button></Link> : undefined}
    />
  );
}
