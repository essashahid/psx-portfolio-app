import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { NewsCard } from "@/components/news-card";
import { ActionButton } from "@/components/action-button";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Newspaper, RefreshCw } from "lucide-react";
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
};

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: holdings } = await supabase
    .from("holdings")
    .select("ticker, sector")
    .eq("user_id", user.id)
    .order("ticker");
  const tickers = [...new Set((holdings ?? []).map((h) => h.ticker))];
  const sectors = [...new Set((holdings ?? []).map((h) => h.sector).filter(Boolean))] as string[];

  let query = supabase
    .from("news_articles")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  if (sp.ticker) query = query.eq("ticker", sp.ticker);
  if (sp.sector) query = query.eq("sector", sp.sector);
  if (sp.sentiment) query = query.eq("sentiment", sp.sentiment);
  if (sp.relevance) query = query.gte("relevance_score", parseInt(sp.relevance, 10));
  if (sp.view === "saved") query = query.eq("saved", true);
  else if (sp.view === "ignored") query = query.eq("ignored", true);
  else query = query.eq("ignored", false);
  if (sp.window) {
    const hours = sp.window === "24h" ? 24 : sp.window === "7d" ? 24 * 7 : 24 * 30;
    // eslint-disable-next-line react-hooks/purity -- server component; wall-clock time is the filter input
    query = query.gte("created_at", new Date(Date.now() - hours * 3600000).toISOString());
  }

  const { data: articles } = await query;

  const filterLink = (patch: Partial<Search>, label: string, active: boolean) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return (
      <Link
        key={label}
        href={`/news?${params.toString()}`}
        className={cn(
          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
          active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="News Center"
        description="Tavily-powered news monitoring for your holdings, analyzed for relevance and thesis impact."
        actions={
          <ActionButton
            endpoint="/api/news/refresh"
            label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh news for all holdings</>}
            size="sm"
          />
        }
      />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-[11px] font-medium text-muted-foreground">Ticker</span>
          {filterLink({ ticker: undefined }, "All", !sp.ticker)}
          {tickers.map((t) => filterLink({ ticker: t }, t, sp.ticker === t))}
        </div>
        {sectors.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 text-[11px] font-medium text-muted-foreground">Sector</span>
            {filterLink({ sector: undefined }, "All", !sp.sector)}
            {sectors.map((s) => filterLink({ sector: s }, s, sp.sector === s))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-[11px] font-medium text-muted-foreground">Filters</span>
          {filterLink({ sentiment: undefined }, "Any sentiment", !sp.sentiment)}
          {["positive", "neutral", "negative"].map((s) =>
            filterLink({ sentiment: s }, s, sp.sentiment === s)
          )}
          {filterLink({ relevance: sp.relevance === "7" ? undefined : "7" }, "High relevance (7+)", sp.relevance === "7")}
          {filterLink({ window: undefined }, "Any time", !sp.window)}
          {filterLink({ window: "24h" }, "24 hours", sp.window === "24h")}
          {filterLink({ window: "7d" }, "7 days", sp.window === "7d")}
          {filterLink({ window: "30d" }, "30 days", sp.window === "30d")}
          {filterLink({ view: sp.view === "saved" ? undefined : "saved" }, "Saved", sp.view === "saved")}
          {filterLink({ view: sp.view === "ignored" ? undefined : "ignored" }, "Ignored", sp.view === "ignored")}
        </div>
      </div>

      {(articles ?? []).length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="No news stored yet"
          description={
            tickers.length === 0
              ? "Import holdings first, then refresh news to start monitoring your portfolio."
              : "Hit “Refresh news for all holdings” to search Pakistani business news for every position via Tavily."
          }
          action={
            tickers.length === 0 ? (
              <Link href="/import"><Button>Go to Import Center</Button></Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(articles ?? []).map((a) => (
            <NewsCard key={a.id} article={a as NewsArticle} />
          ))}
        </div>
      )}
    </div>
  );
}
