import type { NewsEvent } from "@/lib/news/events";

/**
 * Selecting, filtering and grouping the news feed.
 *
 * Lifted out of the web page so the phone reads the same feed rather than a
 * second interpretation of it: a "Suggested" tab that means one thing on the
 * laptop and another on the phone is worse than no tab at all.
 */

export type NewsTabId = "suggested" | "market" | "companies" | "policy" | "upcoming" | "saved";
export type NewsFilterId = "owned" | "watchlist" | "suggested" | "official" | "high";

export const NEWS_TABS: { id: NewsTabId; label: string }[] = [
  { id: "suggested", label: "Suggested" },
  { id: "market", label: "Market" },
  { id: "companies", label: "Companies" },
  { id: "policy", label: "Policy & Economy" },
  { id: "upcoming", label: "Upcoming" },
  { id: "saved", label: "Saved" },
];

export const NEWS_WINDOWS: { id: string; label: string; hours: number | null; today?: boolean }[] = [
  { id: "today", label: "Today", hours: null, today: true },
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "week", label: "This week", hours: 24 * 7 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "month", label: "This month", hours: 24 * 30 },
  { id: "all", label: "All", hours: null },
];

export const NEWS_FILTERS: { id: NewsFilterId; label: string }[] = [
  { id: "owned", label: "Owned" },
  { id: "watchlist", label: "Watchlist" },
  { id: "suggested", label: "Suggested" },
  { id: "official", label: "Official only" },
  { id: "high", label: "High importance" },
];

export function eventsForTab(events: NewsEvent[], tab: NewsTabId): NewsEvent[] {
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

export function filterEvent(event: NewsEvent, filter: NewsFilterId | null): boolean {
  if (!filter) return true;
  if (filter === "owned") return event.affectedHoldings.length > 0;
  if (filter === "watchlist") return event.whySuggested?.includes("watchlist") ?? false;
  if (filter === "suggested") return event.suggested;
  if (filter === "official") return event.verification === "Official";
  if (filter === "high") return event.importance === "Critical" || event.importance === "High";
  return true;
}

export function groupEventsByDate(events: NewsEvent[]): { date: string; events: NewsEvent[] }[] {
  const map = new Map<string, NewsEvent[]>();
  for (const event of events) (map.get(event.dateKey) ?? map.set(event.dateKey, []).get(event.dateKey)!).push(event);
  return [...map.entries()]
    .map(([date, rows]) => ({ date, events: rows.sort((a, b) => b.timestamp - a.timestamp) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function pktDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function pktStartOfToday(): number {
  return new Date(`${pktDateKey(new Date())}T00:00:00+05:00`).getTime();
}

function pktStartOfMonth(): number {
  const ymd = pktDateKey(new Date());
  return new Date(`${ymd.slice(0, 8)}01T00:00:00+05:00`).getTime();
}

function pktStartOfWeek(): number {
  const pkt = new Date(`${pktDateKey(new Date())}T00:00:00+05:00`);
  const day = pkt.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  pkt.setUTCDate(pkt.getUTCDate() - diff);
  return pkt.getTime();
}

export function windowCutoff(windowId: string): number | null {
  const window = NEWS_WINDOWS.find((w) => w.id === windowId);
  if (!window || window.id === "all") return null;
  if (window.today) return pktStartOfToday();
  if (window.id === "month") return pktStartOfMonth();
  if (window.id === "week") return pktStartOfWeek();
  return window.hours ? Date.now() - window.hours * 3600000 : null;
}

/** "Today", "Yesterday", then the weekday and date. */
export function dateHeading(date: string): string {
  const today = pktDateKey(new Date());
  if (date === today) return "Today";
  const yesterday = new Date(`${today}T00:00:00+05:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === pktDateKey(yesterday)) return "Yesterday";
  const parsed = new Date(`${date}T00:00:00+05:00`);
  return parsed.toLocaleDateString("en-PK", { weekday: "long", month: "long", day: "numeric" });
}

export type UpcomingItem = {
  id: string;
  date: string;
  title: string;
  topic: string;
  relevance: string;
  href: string | null;
};

export type DividendEventRow = {
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

export type MarketEventRow = {
  ticker: string | null;
  company_name: string | null;
  sector: string | null;
  event_type: string;
  title: string;
  source_url: string | null;
  event_date: string;
  event_time: string | null;
};

export function buildUpcomingItems(input: {
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
