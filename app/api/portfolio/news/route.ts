import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getPortfolio } from "@/lib/portfolio/positions";
import { getDailyHoldingPerformance } from "@/lib/portfolio/daily-performance";
import { getUserNewsFeed, type FeedNewsArticle } from "@/lib/news/global-store";
import { buildNewsEvents, eventMatchesSearch, type NewsEvent } from "@/lib/news/events";
import {
  NEWS_TABS,
  buildUpcomingItems,
  dateHeading,
  eventsForTab,
  filterEvent,
  groupEventsByDate,
  pktDateKey,
  windowCutoff,
  type DividendEventRow,
  type MarketEventRow,
  type NewsFilterId,
  type NewsTabId,
} from "@/lib/news/feed";
import { getPrefs, type UserPrefs } from "@/lib/user/preferences";
import { sectorColor } from "@psx/shared/sector-colors";
import type { NewsEventSummary, NewsResponse } from "@psx/shared/api/news";

/**
 * The News Centre for the phone, in one request.
 *
 * Selection, filtering and grouping come from lib/news/feed, which the web
 * page reads too. What differs here is only how much is sent: a phone gets the
 * event and what it touches, not the article body or the image.
 */
export async function GET(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const tab = (NEWS_TABS.find((t) => t.id === url.searchParams.get("tab"))?.id ?? "suggested") as NewsTabId;
    const windowId = url.searchParams.get("window") ?? "week";
    const query = url.searchParams.get("q")?.trim() ?? "";
    const activeTicker = url.searchParams.get("ticker")?.trim().toUpperCase() || null;
    const activeFilter = (url.searchParams.get("filter") || null) as NewsFilterId | null;
    const todayKey = pktDateKey(new Date());

    const [portfolio, articles, watchlistRes, sourceRes, dividendEventsRes, marketEventsRes, daily, prefs] =
      await Promise.all([
        getPortfolio(supabase, user.id),
        getUserNewsFeed(supabase, user.id, 260),
        supabase.from("stock_watchlist").select("ticker").eq("user_id", user.id),
        supabase.from("news_sources").select("enabled, health_status, last_success_at, updated_at"),
        supabase
          .from("dividend_events")
          .select(
            "id, ticker, company_name, event_type, status, announcement_date, ex_date, payment_date, estimated_payment_start, estimated_payment_end, source_url, is_forecast"
          )
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
        getPrefs(supabase, user.id).catch(() => ({}) as UserPrefs),
      ]);

    const holdings = portfolio.holdings.map((h) => ({
      ticker: h.ticker,
      company_name: h.company_name,
      sector: h.sector,
      weight: h.weight,
    }));
    const watchlist = [...new Set((watchlistRes.data ?? []).map((row) => String(row.ticker)))];
    const events = buildNewsEvents(articles as FeedNewsArticle[], { holdings, watchlist });

    const cutoff = windowCutoff(windowId);
    const inWindow = (event: NewsEvent) => !cutoff || event.timestamp >= cutoff;
    const visible = events
      .filter((event) => !event.ignored)
      // Saved is a place you put things deliberately, so a date window must not
      // hide them.
      .filter((event) => (tab === "saved" ? true : inWindow(event)))
      .filter((event) => eventMatchesSearch(event, query))
      .filter((event) => filterEvent(event, activeFilter))
      .filter((event) => !activeTicker || event.affectedHoldings.includes(activeTicker));

    const toSummary = (event: NewsEvent): NewsEventSummary => ({
      id: event.id,
      articleId: event.primaryArticleId,
      storage: event.storage,
      title: event.title,
      summary: event.summary,
      url: event.url,
      source: event.source,
      category: event.category,
      importance: event.importance as NewsEventSummary["importance"],
      verification: event.verification,
      suggested: event.suggested,
      whySuggested: event.whySuggested,
      affectedHoldings: event.affectedHoldings,
      affectedSectors: event.affectedSectors,
      whatToWatch: event.whatToWatch,
      timeLabel: event.timeLabel,
      dateKey: event.dateKey,
      timestamp: event.timestamp,
      relatedCount: event.relatedCount,
      saved: event.saved,
      lowConfidence: event.lowConfidence,
      color: event.affectedSectors[0] ? sectorColor(event.affectedSectors[0]) : null,
    });

    const suggested = visible.filter((event) => event.suggested && event.importance !== "Routine");
    // The lead is the most consequential suggestion, not simply the newest.
    const featured =
      tab === "suggested"
        ? (suggested.find((event) => event.importance === "Critical" || event.importance === "High") ??
          suggested[0] ??
          null)
        : null;

    const feed = eventsForTab(visible, tab)
      .filter((event) => event.id !== featured?.id)
      .slice(0, 60);

    const countByTicker = new Map<string, number>();
    for (const event of visible) {
      for (const ticker of event.affectedHoldings) {
        countByTicker.set(ticker, (countByTicker.get(ticker) ?? 0) + 1);
      }
    }
    const moves = new Map((daily?.rows ?? []).map((row) => [row.ticker, row.dayChangePct]));

    const lastSeenMs = prefs.news_last_seen_at ? new Date(prefs.news_last_seen_at).getTime() : null;

    const body: NewsResponse = {
      featured: featured ? toSummary(featured) : null,
      groups: groupEventsByDate(feed).map((group) => ({
        dateKey: group.date,
        label: dateHeading(group.date),
        events: group.events.map(toSummary),
      })),
      tabs: NEWS_TABS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        count: entry.id === "upcoming" ? 0 : eventsForTab(visible, entry.id).length,
      })),
      symbols: [...portfolio.holdings]
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
        .map((h) => ({
          ticker: h.ticker,
          move: moves.get(h.ticker) ?? null,
          count: countByTicker.get(h.ticker) ?? 0,
        })),
      upcoming: buildUpcomingItems({
        dividends: (dividendEventsRes.data ?? []) as DividendEventRow[],
        marketEvents: (marketEventsRes.data ?? []) as MarketEventRow[],
        holdings,
        watchlist,
        todayKey,
      }),
      newSinceLastVisit: lastSeenMs
        ? events.filter((event) => !event.ignored && event.timestamp > lastSeenMs).length
        : 0,
      importantCount: suggested.filter((e) => e.importance === "Critical" || e.importance === "High").length,
      sourceHealth: sourceHealth(sourceRes.data ?? [], articles as FeedNewsArticle[]),
      count: feed.length + (featured ? 1 : 0),
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

/** How fresh the feed is and how many sources are answering, in one line. */
function sourceHealth(
  rows: { enabled?: boolean; health_status?: string | null; last_success_at?: string | null; updated_at?: string | null }[],
  articles: FeedNewsArticle[]
): string {
  const enabled = rows.filter((row) => row.enabled !== false);
  const healthy = enabled.filter((row) => row.health_status !== "error").length;
  const total = enabled.length || rows.length;
  const latestSource = rows
    .map((row) => row.last_success_at ?? row.updated_at)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
  const latestArticle = articles
    .map((article) => article.published_at ?? article.created_at)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
  const latest = latestSource ?? latestArticle;
  const freshness = latest ? ago(latest) : "recently";
  return total > 0 ? `Updated ${freshness} · ${healthy} of ${total} sources healthy` : `Updated ${freshness}`;
}

function ago(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hours ago`;
  return date.toLocaleDateString("en-PK", { day: "numeric", month: "short" });
}
