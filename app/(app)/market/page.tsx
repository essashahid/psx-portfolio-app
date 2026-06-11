import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/supabase/server";
import { getMarketDashboard, type EventRow, type OwnedPerf } from "@/lib/market/read";
import { fmtPct, fmtCompact, fmtInt, tone } from "@/lib/market/format";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { SectorBarsLazy, MarketHeatmapLazy, MoversBoardLazy } from "@/components/market/lazy";
import { cn } from "@/lib/utils";
import { Activity, TrendingUp, TrendingDown, Gauge, Sparkles, FileText, Newspaper, RefreshCw, ArrowUpRight, ArrowDownRight } from "lucide-react";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  result: "Financial result",
  dividend: "Dividend / payout",
  board_meeting: "Board meeting",
  material: "Material info",
  corporate_announcement: "Announcement",
};

export default async function MarketPulsePage() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const d = await getMarketDashboard(supabase, user.id);

  const refresh = (
    <ActionButton
      endpoint="/api/market/refresh"
      body={{ section: "all" }}
      label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh market</>}
      variant="outline"
      size="sm"
    />
  );

  if (!d.snapshot) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="PSX" title="Market Pulse" description="The whole Pakistan Stock Exchange at a glance — breadth, sectors, movers, and official events." actions={refresh} />
        <EmptyState
          icon={Activity}
          title="No market snapshot yet"
          description="The Market Pulse engine builds a daily snapshot from the official PSX market-watch and indices feeds. Run a refresh to pull today's whole-market data."
          action={refresh}
        />
      </div>
    );
  }

  const s = d.snapshot;
  const breadthTotal = s.total_advancers + s.total_decliners + s.total_unchanged || 1;
  const advPct = (s.total_advancers / breadthTotal) * 100;
  const decPct = (s.total_decliners / breadthTotal) * 100;
  const breadthRatio = s.total_decliners > 0 ? s.total_advancers / s.total_decliners : s.total_advancers;
  const indexTone = tone(s.index_change_percent);

  const sectorNames = [...new Set(d.heatmap.map((i) => i.sector).filter((x): x is string => !!x))].sort();
  const todaysEvents = d.events;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="PSX · Market Pulse"
        title="Market Pulse"
        description="The whole Pakistan Stock Exchange at a glance — index, breadth, sectors, movers, and official events."
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {d.updatedLabel ? `Updated ${d.updatedLabel} PKT` : ""} · {s.source_provider}
            </span>
            {refresh}
          </div>
        }
      />

      {/* ── Hero: index + breadth + volume ─────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className={cn("rise lg:col-span-1 overflow-hidden", indexTone === "positive" ? "border-emerald-200" : indexTone === "negative" ? "border-red-200" : "")}>
          <CardContent className="p-5">
            {s.index_name ? (
              <>
                <p className="eyebrow">{s.index_name}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{s.index_value?.toLocaleString("en-PK", { maximumFractionDigits: 2 }) ?? "—"}</p>
                <p className={cn("mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums", indexTone === "positive" ? "text-emerald-600" : indexTone === "negative" ? "text-red-600" : "text-muted-foreground")}>
                  {indexTone === "positive" ? <ArrowUpRight className="h-4 w-4" /> : indexTone === "negative" ? <ArrowDownRight className="h-4 w-4" /> : null}
                  {fmtInt(s.index_change)} ({fmtPct(s.index_change_percent)})
                </p>
              </>
            ) : (
              <>
                <p className="eyebrow">Index</p>
                <p className="mt-2 text-sm font-medium">Index data unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">No index level was published by the configured providers. The overview below is based on stock-level breadth.</p>
              </>
            )}
            <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{s.snapshot_date}</span>
              <span className={cn("rounded-full px-2 py-0.5 font-medium", s.freshness === "fresh" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{s.freshness}</span>
            </div>
          </CardContent>
        </Card>

        {/* Breadth */}
        <Card className="rise rise-1 lg:col-span-2">
          <CardContent className="flex h-full flex-col justify-center p-5">
            <div className="flex items-center justify-between">
              <p className="eyebrow flex items-center gap-1.5"><Gauge className="h-3.5 w-3.5" /> Market breadth</p>
              <p className="text-[11px] text-muted-foreground">A/D ratio <span className="font-semibold text-foreground tabular-nums">{breadthRatio.toFixed(2)}</span></p>
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${advPct}%` }} />
              <div className="h-full bg-zinc-300 transition-all duration-700" style={{ width: `${100 - advPct - decPct}%` }} />
              <div className="h-full bg-red-500 transition-all duration-700" style={{ width: `${decPct}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Advancing" value={fmtInt(s.total_advancers)} tone="positive" />
              <Stat label="Unchanged" value={fmtInt(s.total_unchanged)} />
              <Stat label="Declining" value={fmtInt(s.total_decliners)} tone="negative" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
              <Stat label="Volume" value={fmtCompact(s.total_volume)} />
              <Stat label="Value traded*" value={`₨${fmtCompact(s.total_value)}`} />
              <Stat label="Most active" value={s.most_active_ticker ?? "—"} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sector callouts */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard icon={TrendingUp} label="Top sector" value={s.top_sector ?? "—"} tone="positive" />
        <MiniCard icon={TrendingDown} label="Weakest sector" value={s.bottom_sector ?? "—"} tone="negative" />
        <MiniCard icon={Activity} label="Stocks traded" value={fmtInt(s.item_count)} />
        <MiniCard icon={FileText} label="Official filings today" value={fmtInt(todaysEvents.length)} />
      </div>

      {/* ── AI brief ───────────────────────────────────────────────────── */}
      <Card className="rise">
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-emerald-600" /> AI Market Brief</CardTitle>
            <CardDescription>Descriptive summary from today&apos;s data — not financial advice.</CardDescription>
          </div>
          <ActionButton endpoint="/api/market/refresh" body={{ section: "brief" }} label="Regenerate" variant="ghost" size="sm" />
        </CardHeader>
        <CardContent>
          {d.brief ? (
            <div className="space-y-2">
              {d.brief.content.split(/\n\n+/).map((para, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/90">{para}</p>
              ))}
              <p className="pt-1 text-[10px] text-muted-foreground">Generated {new Date(d.brief.created_at).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" })}{d.brief.model ? ` · ${d.brief.model}` : ""}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No brief generated yet. Use “Regenerate” to create today&apos;s market brief.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Sector performance ─────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="rise">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4" /> Sector performance</CardTitle>
            <CardDescription>Average return by sector. Toggle to volume to see where activity is concentrated.</CardDescription>
          </CardHeader>
          <CardContent>
            <SectorBarsLazy sectors={d.sectors} />
          </CardContent>
        </Card>

        <Card className="rise rise-1">
          <CardHeader>
            <CardTitle>Sector heatmap</CardTitle>
            <CardDescription>Each tile is a sector, shaded by average return. Breadth shown as advancers ↑ / decliners ↓.</CardDescription>
          </CardHeader>
          <CardContent>
            <SectorHeatGrid sectors={d.sectors} />
          </CardContent>
        </Card>
      </div>

      {/* ── Market heatmap ─────────────────────────────────────────────── */}
      <Card className="rise">
        <CardHeader>
          <CardTitle>PSX heatmap</CardTitle>
          <CardDescription>Every traded stock — sized by value, coloured by day change. Filter by sector, gainers/losers, or your own positions.</CardDescription>
        </CardHeader>
        <CardContent>
          <MarketHeatmapLazy items={d.heatmap} sectors={sectorNames} owned={[...d.ownedTickers]} watched={[...d.watchTickers]} />
        </CardContent>
      </Card>

      {/* ── Top movers ─────────────────────────────────────────────────── */}
      <Card className="rise">
        <CardHeader>
          <CardTitle>Top movers</CardTitle>
          <CardDescription>Gainers, losers, volume &amp; value leaders, unusual volume, and 52-week extremes. Click any stock to open its cockpit.</CardDescription>
        </CardHeader>
        <CardContent>
          <MoversBoardLazy movers={d.movers} owned={[...d.ownedTickers]} watched={[...d.watchTickers]} />
        </CardContent>
      </Card>

      {/* ── My portfolio vs market ─────────────────────────────────────── */}
      {d.ownedTickers.size > 0 && (
        <PortfolioVsMarket owned={d.owned} events={todaysEvents} ownedTickers={d.ownedTickers} />
      )}

      {/* ── Announcements today ────────────────────────────────────────── */}
      <Card className="rise">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Official events today</CardTitle>
          <CardDescription>Company filings from the PSX portal for {s.snapshot_date}. Official sources are highlighted.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventsList events={todaysEvents} ownedTickers={d.ownedTickers} watchTickers={d.watchTickers} />
        </CardContent>
      </Card>

      {/* ── Market news pointer ────────────────────────────────────────── */}
      <Card className="rise">
        <CardContent className="flex flex-col items-start gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Market &amp; sector news</p>
              <p className="text-xs text-muted-foreground">Curated, credible Pakistani market news with AI relevance scoring lives in the News Center.</p>
            </div>
          </div>
          <Link href="/news" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted">Open News Center →</Link>
        </CardContent>
      </Card>

      <p className="pb-2 text-center text-[10px] text-muted-foreground">
        Source: official PSX market-watch + indices via {s.source_provider} · snapshot {s.snapshot_date} · *value traded is volume × price (approx). Not investment advice.
      </p>
    </div>
  );
}

// ── Small server components ──────────────────────────────────────────────

function Stat({ label, value, tone: t }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div>
      <p className={cn("text-base font-semibold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-foreground")}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function MiniCard({ icon: Icon, label, value, tone: t }: { icon: typeof Activity; label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <Card className="rise rise-1">
      <CardContent className="flex items-center gap-3 p-4">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", t === "positive" ? "bg-emerald-50 text-emerald-600" : t === "negative" ? "bg-red-50 text-red-600" : "bg-muted text-muted-foreground")}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="truncate text-sm font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SectorHeatGrid({ sectors }: { sectors: { sector: string; average_return: number | null; advancers: number; decliners: number; stock_count: number }[] }) {
  const rows = sectors.filter((s) => s.stock_count >= 2 && s.average_return != null).sort((a, b) => (b.average_return ?? 0) - (a.average_return ?? 0));
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">No sector data in this snapshot.</p>;
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {rows.map((s) => {
        const r = s.average_return ?? 0;
        const t = tone(r);
        return (
          <div key={s.sector} className={cn("rounded-md border p-2", t === "positive" ? "border-emerald-200 bg-emerald-50/70" : t === "negative" ? "border-red-200 bg-red-50/70" : "border-border bg-muted/40")}>
            <p className="truncate text-[11px] font-medium" title={s.sector}>{s.sector}</p>
            <p className={cn("text-sm font-bold tabular-nums", t === "positive" ? "text-emerald-700" : t === "negative" ? "text-red-700" : "text-foreground")}>{fmtPct(r)}</p>
            <p className="text-[9px] text-muted-foreground">{s.advancers}↑ {s.decliners}↓ · {s.stock_count}</p>
          </div>
        );
      })}
    </div>
  );
}

function PortfolioVsMarket({ owned, events, ownedTickers }: { owned: OwnedPerf[]; events: EventRow[]; ownedTickers: Set<string> }) {
  const gaining = owned.filter((o) => (o.change_percent ?? 0) > 0);
  const losing = owned.filter((o) => (o.change_percent ?? 0) < 0);
  const outperform = owned.filter((o) => (o.vsSector ?? 0) > 0);
  const underperform = owned.filter((o) => (o.vsSector ?? 0) < 0);
  const ownedEvents = events.filter((e) => ownedTickers.has(e.ticker));
  const avgChange = owned.length ? owned.reduce((s, o) => s + (o.change_percent ?? 0), 0) / owned.length : null;

  return (
    <Card className="rise border-emerald-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4 text-emerald-600" /> My holdings vs market</CardTitle>
        <CardDescription>
          {owned.length} of your holdings traded today · average move {fmtPct(avgChange)} · {gaining.length} up, {losing.length} down.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s moves</p>
          <div className="space-y-1">
            {owned.slice(0, 8).map((o) => {
              const t = tone(o.change_percent);
              return (
                <Link key={o.ticker} href={`/stocks/${o.ticker}`} className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
                  <div className="min-w-0">
                    <span className="text-xs font-semibold">{o.ticker}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{o.sector ?? ""}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {o.vsSector != null && (
                      <span className={cn("text-[10px] font-medium", o.vsSector >= 0 ? "text-emerald-600" : "text-red-600")} title="vs sector average">
                        {o.vsSector >= 0 ? "outperforming" : "lagging"} sector
                      </span>
                    )}
                    <span className={cn("w-16 text-right text-xs font-bold tabular-nums", t === "positive" ? "text-emerald-600" : t === "negative" ? "text-red-600" : "text-foreground")}>{fmtPct(o.change_percent)}</span>
                  </div>
                </Link>
              );
            })}
            {owned.length === 0 && <p className="text-xs text-muted-foreground">None of your holdings traded in today&apos;s snapshot.</p>}
          </div>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <SummaryPill label="Outperforming sector" value={outperform.length} tone="positive" />
            <SummaryPill label="Lagging sector" value={underperform.length} tone="negative" />
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your holdings with filings today</p>
            {ownedEvents.length ? (
              <div className="space-y-1">
                {ownedEvents.slice(0, 5).map((e, i) => (
                  <Link key={i} href={`/stocks/${e.ticker}`} className="block rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted/60">
                    <span className="font-semibold">{e.ticker}</span> <span className="text-muted-foreground">— {e.title}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No official filings from your holdings today.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({ label, value, tone: t }: { label: string; value: number; tone: "positive" | "negative" }) {
  return (
    <div className={cn("rounded-lg border p-2.5", t === "positive" ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60")}>
      <p className={cn("text-lg font-semibold tabular-nums", t === "positive" ? "text-emerald-700" : "text-red-700")}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function EventsList({ events, ownedTickers, watchTickers }: { events: EventRow[]; ownedTickers: Set<string>; watchTickers: Set<string> }) {
  if (!events.length) return <p className="py-8 text-center text-xs text-muted-foreground">No official filings detected today. The feed refreshes through the trading day.</p>;
  const order = ["result", "dividend", "board_meeting", "material", "corporate_announcement"];
  const sorted = [...events].sort((a, b) => order.indexOf(a.event_type) - order.indexOf(b.event_type));
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {sorted.slice(0, 40).map((e, i) => {
        const isOwned = ownedTickers.has(e.ticker);
        const isWatch = watchTickers.has(e.ticker);
        return (
          <div key={i} className={cn("flex items-start gap-3 px-3 py-2", isOwned && "bg-emerald-50/40")}>
            <Link href={`/stocks/${e.ticker}`} className="w-16 shrink-0">
              <span className="text-xs font-semibold hover:underline">{e.ticker}</span>
              {isOwned && <span className="ml-1 rounded bg-emerald-100 px-1 py-px text-[8px] font-semibold text-emerald-700">OWNED</span>}
              {!isOwned && isWatch && <span className="ml-1 rounded bg-muted px-1 py-px text-[8px] font-semibold text-muted-foreground">WATCH</span>}
            </Link>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium leading-snug">{e.title}</p>
              <p className="text-[10px] text-muted-foreground">{e.company_name ?? ""}{e.event_time ? ` · ${e.event_time}` : ""}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
              {e.source_url && (
                <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-emerald-600 hover:underline">PSX source ↗</a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
