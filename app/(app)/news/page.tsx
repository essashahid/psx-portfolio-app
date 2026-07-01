import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { NewsCard } from "@/components/news-card";
import { NewsTickerSelect } from "@/components/news-ticker-select";
import { NewsBriefWidget } from "@/components/news-brief-widget";
import { claudeConfigured } from "@/lib/ai/claude";
import { ActionButton } from "@/components/action-button";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Newspaper, RefreshCw } from "lucide-react";
import type { NewsArticle } from "@/lib/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Search = {
  tab?: string;
  ticker?: string;
  window?: string;
};

type TabId = "foryou" | "markets" | "policy" | "companies" | "saved";

const TABS: { id: TabId; label: string }[] = [
  { id: "foryou", label: "For You" },
  { id: "markets", label: "Markets" },
  { id: "policy", label: "Policy & Economy" },
  { id: "companies", label: "Companies" },
  { id: "saved", label: "Saved" },
];

const WINDOWS: { id: string; label: string; hours: number | null }[] = [
  { id: "today", label: "Today", hours: null }, // "Today" = the Pakistan calendar day, computed separately.
  { id: "week", label: "Week", hours: 24 * 7 },
  { id: "month", label: "Month", hours: 24 * 30 },
  { id: "all", label: "All", hours: null },
];

/** Start of the current day in Pakistan (PKT, UTC+5) as an epoch timestamp. */
function pktStartOfToday(): number {
  // eslint-disable-next-line react-hooks/purity -- wall-clock is the intended input
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:00`).getTime();
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? "foryou") as TabId;
  const windowId = WINDOWS.find((w) => w.id === sp.window)?.id ?? "week";
  const windowHours = WINDOWS.find((w) => w.id === windowId)?.hours ?? null;

  const [holdingsRes, articlesRes, briefRes] = await Promise.all([
    supabase.from("holdings").select("ticker").eq("user_id", user.id).gt("quantity", 0).order("ticker"),
    supabase
      .from("news_articles")
      .select("*")
      .eq("user_id", user.id)
      .or("ignored.eq.false,saved.eq.true")
      .order("created_at", { ascending: false })
      .limit(180),
    supabase
      .from("ai_briefings")
      .select("id, content, model, created_at")
      .eq("user_id", user.id)
      .eq("briefing_type", "news_brief")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const tickers = [...new Set((holdingsRes.data ?? []).map((h) => h.ticker))];
  const all = (articlesRes.data ?? []) as NewsArticle[];
  const latestBrief = briefRes.data
    ? { content: briefRes.data.content as string, model: (briefRes.data.model as string) ?? "", createdAt: briefRes.data.created_at as string }
    : null;

  // One fetch, partitioned in memory — far simpler than six query branches.
  const visible = all.filter((a) => !a.ignored);
  // eslint-disable-next-line react-hooks/purity -- server component; wall-clock time is the filter input
  const cutoff =
    windowId === "today"
      ? pktStartOfToday()
      : windowHours
        ? // eslint-disable-next-line react-hooks/purity -- wall-clock is the filter input
          Date.now() - windowHours * 3600000
        : null;
  const inWindow = (a: NewsArticle) => {
    if (!cutoff) return true;
    const t = new Date(a.published_at ?? a.created_at).getTime();
    return Number.isNaN(t) || t >= cutoff;
  };
  const matchesTicker = (a: NewsArticle) =>
    !sp.ticker || a.ticker === sp.ticker || (a.impact_tickers ?? []).includes(sp.ticker);

  const pools: Record<TabId, NewsArticle[]> = {
    foryou: visible.filter(
      (a) =>
        !a.low_confidence &&
        ((a.scope === "portfolio" && (a.relevance_score ?? 0) >= 4) ||
          (a.scope === "market" && (a.is_interesting || (a.relevance_score ?? 0) >= 6)))
    ),
    markets: visible.filter((a) => a.scope === "market" && isMarketCategory(a.category)),
    policy: visible.filter((a) => a.category === "policy" || a.category === "economy"),
    companies: visible.filter((a) => a.scope === "portfolio"),
    saved: all.filter((a) => a.saved),
  };

  const counts = Object.fromEntries(
    TABS.map((t) => [t.id, pools[t.id].filter((a) => (t.id === "saved" ? true : inWindow(a))).filter(matchesTicker).length])
  ) as Record<TabId, number>;

  let feed = pools[tab].filter(matchesTicker);
  if (tab !== "saved") feed = feed.filter(inWindow);

  const lead =
    tab === "saved"
      ? null
      : [...feed].sort(
          (a, b) =>
            Number(b.is_interesting) - Number(a.is_interesting) ||
            (b.relevance_score ?? 0) - (a.relevance_score ?? 0) ||
            articleTime(b) - articleTime(a)
        )[0] ?? null;

  const rest = lead ? feed.filter((a) => a.id !== lead.id) : feed;
  const groups = groupByDate(rest);

  const buildHref = (patch: Partial<Search>) => {
    const merged = { tab, window: windowId, ticker: sp.ticker, ...patch };
    const params = new URLSearchParams();
    if (merged.tab && merged.tab !== "foryou") params.set("tab", merged.tab);
    if (merged.window && merged.window !== "week") params.set("window", merged.window);
    if (merged.ticker) params.set("ticker", merged.ticker);
    const qs = params.toString();
    return qs ? `/news?${qs}` : "/news";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">PSX intelligence</p>
          <h1 className="text-2xl font-semibold tracking-editorial sm:text-3xl">News</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Market-moving news, policy, and your holdings — screened and ranked for a PSX investor.
          </p>
        </div>
        <ActionButton
          endpoint="/api/news/refresh"
          label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh</>}
          size="sm"
        />
      </div>

      <NewsBriefWidget hasNews={all.length > 0} claudeAvailable={claudeConfigured()} initialBrief={latestBrief} />

      {/* Topic tabs */}
      <div className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-border bg-background/85 px-1 backdrop-blur">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={buildHref({ tab: t.id })}
              className={cn(
                "relative whitespace-nowrap px-3 py-2.5 text-[13px] font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {counts[t.id] > 0 && (
                <span className={cn("ml-1.5 text-[11px] tabular-nums", active ? "text-foreground/60" : "text-muted-foreground/60")}>
                  {counts[t.id]}
                </span>
              )}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" />}
            </Link>
          );
        })}
      </div>

      {/* Secondary controls */}
      {tab !== "saved" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {WINDOWS.map((w) => (
              <Link
                key={w.id}
                href={buildHref({ window: w.id })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  windowId === w.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {w.label}
              </Link>
            ))}
          </div>
          {tickers.length > 0 && (tab === "foryou" || tab === "companies") && (
            <NewsTickerSelect tickers={tickers} active={sp.ticker} tab={tab === "foryou" ? undefined : tab} window={windowId === "week" ? undefined : windowId} />
          )}
        </div>
      )}

      {/* Feed */}
      {feed.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={tickers.length === 0 ? "Import holdings to personalize" : "No news here yet"}
          description={
            tickers.length === 0
              ? "Import your holdings, then refresh to start tracking market and company news."
              : tab === "saved"
                ? "Bookmark stories with the save icon to keep them here."
                : "Try a wider time window, or refresh to pull the latest news."
          }
          action={
            tickers.length === 0 ? (
              <Link href="/import"><Button>Go to Import Center</Button></Link>
            ) : tab !== "saved" && windowId !== "all" ? (
              <Link href={buildHref({ window: "all" })}><Button variant="outline">Show all time</Button></Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {lead && (
            <div className="border-b border-border pb-6">
              <p className="eyebrow mb-2">Top story</p>
              <NewsCard article={lead} lead />
            </div>
          )}
          {groups.map((group) => (
            <section key={group.date} className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{formatHeading(group.date)}</h2>
                <span className="text-[11px] tabular-nums text-muted-foreground/60">{group.articles.length}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="divide-y divide-border/70">
                {group.articles.map((a) => (
                  <div key={a.id} className="py-4 first:pt-0">
                    <NewsCard article={a} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function isMarketCategory(category: string | null): boolean {
  return category === "market" || category === "commodity" || category === "international";
}

function articleTime(a: NewsArticle): number {
  const t = new Date(a.published_at ?? a.created_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function groupByDate(articles: NewsArticle[]): { date: string; articles: NewsArticle[] }[] {
  const map = new Map<string, NewsArticle[]>();
  for (const a of articles) {
    const key = String(a.published_at ?? a.created_at).slice(0, 10);
    (map.get(key) ?? map.set(key, []).get(key)!).push(a);
  }
  return [...map.entries()]
    .map(([date, rows]) => ({ date, articles: rows.sort((x, y) => articleTime(y) - articleTime(x)) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const today = new Date();
  const key = (d: Date) => d.toISOString().slice(0, 10);
  if (key(parsed) === key(today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (key(parsed) === key(yesterday)) return "Yesterday";
  return parsed.toLocaleDateString("en-PK", { weekday: "long", month: "long", day: "numeric" });
}
