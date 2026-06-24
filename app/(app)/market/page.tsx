import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getMarketDashboard } from "@/lib/market/read";
import { getForeignFlowHistory, getForeignFlowSnapshot, getPortfolioFlowExposure } from "@/lib/market/foreign-flows";
import { fmtCompact, fmtInt, fmtPct, tone } from "@/lib/market/format";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { MarketPulseWorkspace } from "@/components/market/market-pulse-workspace";
import { Activity, ArrowDownRight, ArrowUpRight, Gauge, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MarketPulsePage() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const foreignFlow = await getForeignFlowSnapshot(supabase, 90);
  const [market, flowHistory, flowExposure] = await Promise.all([
    getMarketDashboard(supabase, user.id),
    getForeignFlowHistory(supabase, 90),
    getPortfolioFlowExposure(supabase, user.id, foreignFlow),
  ]);
  const refresh = <ActionButton endpoint="/api/market/refresh" body={{ section: "all" }} label={<><RefreshCw className="h-3.5 w-3.5" /> Refresh market</>} variant="outline" size="sm" />;

  if (!market.snapshot) {
    return <div className="space-y-6"><header><p className="eyebrow">PSX · Market Pulse</p><h1 className="mt-1 text-2xl font-semibold">Market Pulse</h1></header><EmptyState icon={Activity} title="No market snapshot yet" description="Refresh the PSX market snapshot to load breadth, sector and mover data." action={refresh} /></div>;
  }

  const snapshot = market.snapshot;
  const breadthTotal = snapshot.total_advancers + snapshot.total_decliners + snapshot.total_unchanged || 1;
  const advancingPct = snapshot.total_advancers / breadthTotal * 100;
  const decliningPct = snapshot.total_decliners / breadthTotal * 100;
  const unchangedPct = Math.max(0, 100 - advancingPct - decliningPct);
  const ratio = snapshot.total_decliners ? snapshot.total_advancers / snapshot.total_decliners : snapshot.total_advancers;
  const indexTone = tone(snapshot.index_change_percent);
  const leaders = market.sectors.filter((sector) => sector.average_return !== null).sort((a, b) => (b.average_return ?? 0) - (a.average_return ?? 0));
  const strongest = leaders[0];
  const weakest = leaders.at(-1);
  const relevantEvents = market.events.filter((event) => market.ownedTickers.has(event.ticker));

  return (
    <div className="space-y-7 pb-4">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div><p className="eyebrow">PSX · Market Pulse</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Market Pulse</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Pakistan Stock Exchange overview, market breadth, sector leadership, investor flows and portfolio relevance.</p><p className="mt-3 text-xs text-muted-foreground">Updated {market.updatedLabel ?? snapshot.snapshot_date} PKT · {snapshot.freshness === "fresh" ? "Market data current" : `Market data ${snapshot.freshness}`} · Latest flow data: {foreignFlow?.day.date ?? "not available"}</p></div>
        {refresh}
      </header>

      <section className="grid border-y border-border py-5 lg:grid-cols-[1fr_1.15fr_1fr]">
        <div className="border-b border-border pb-5 lg:border-b-0 lg:border-r lg:pr-6">
          <p className="eyebrow">{snapshot.index_name ?? "KSE-100"}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{snapshot.index_value?.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}</p>
          <p className={cn("mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums", indexTone === "positive" ? "text-emerald-700" : indexTone === "negative" ? "text-red-700" : "text-muted-foreground")}>{indexTone === "positive" ? <ArrowUpRight className="h-4 w-4" /> : indexTone === "negative" ? <ArrowDownRight className="h-4 w-4" /> : null}{fmtInt(snapshot.index_change)} · {fmtPct(snapshot.index_change_percent)}</p>
        </div>
        <div className="border-b border-border py-5 lg:border-b-0 lg:border-r lg:px-6 lg:py-0"><div className="flex items-center justify-between"><p className="eyebrow flex items-center gap-1"><Gauge className="h-3.5 w-3.5" /> Market breadth</p><span className="text-xs text-muted-foreground">A/D ratio <strong className="tabular-nums text-foreground">{ratio.toFixed(2)}</strong></span></div><div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted"><span className="bg-emerald-600" style={{ width: `${advancingPct}%` }} /><span className="bg-zinc-300" style={{ width: `${unchangedPct}%` }} /><span className="bg-red-600" style={{ width: `${decliningPct}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-2"><MarketStat label="Advancing" value={fmtInt(snapshot.total_advancers)} tone="positive" /><MarketStat label="Unchanged" value={fmtInt(snapshot.total_unchanged)} /><MarketStat label="Declining" value={fmtInt(snapshot.total_decliners)} tone="negative" /></div></div>
        <div className="pt-5 lg:pl-6 lg:pt-0"><p className="eyebrow">Market activity</p><div className="mt-3 grid grid-cols-3 gap-2"><MarketStat label="Volume" value={fmtCompact(snapshot.total_volume)} /><MarketStat label="Value" value={`PKR ${fmtCompact(snapshot.total_value)}`} /><MarketStat label="Most active" value={snapshot.most_active_ticker ?? "—"} /></div></div>
      </section>

      {market.owned.length > 0 && <section className="border-t border-border pt-5"><div className="flex items-baseline justify-between"><div><h2 className="text-lg font-semibold">My Portfolio Today</h2><p className="mt-1 text-xs text-muted-foreground">Relative performance compares each holding&apos;s daily move with its sector average.</p></div><span className="text-xs text-muted-foreground">{market.owned.length} priced holdings</span></div><div className="mt-5 grid gap-7 xl:grid-cols-[1fr_1fr]">
        <div><div className="flex gap-6 border-b border-border pb-3 text-sm"><span><strong className="tabular-nums text-emerald-700">{market.owned.filter((holding) => (holding.vsSector ?? 0) > 0).length}</strong> outperformed sectors</span><span><strong className="tabular-nums text-red-700">{market.owned.filter((holding) => (holding.vsSector ?? 0) < 0).length}</strong> lagged sectors</span></div><RelativeList title="Strongest relative performance" rows={[...market.owned].filter((holding) => holding.vsSector !== null && holding.vsSector > 0).sort((a, b) => (b.vsSector ?? 0) - (a.vsSector ?? 0)).slice(0, 3)} /><RelativeList title="Largest relative lag" rows={[...market.owned].filter((holding) => holding.vsSector !== null && holding.vsSector < 0).sort((a, b) => (a.vsSector ?? 0) - (b.vsSector ?? 0)).slice(0, 3)} /></div>
        <div className="grid gap-5 sm:grid-cols-2"><PortfolioFlows rows={flowExposure} flowDate={foreignFlow?.day.date ?? null} unit={foreignFlow ? `${foreignFlow.day.currency} mn` : ""} /><RelevantEvents events={relevantEvents} /></div>
      </div></section>}

      <section className="border-t border-border pt-5"><h2 className="text-lg font-semibold">Market Summary</h2><div className="mt-3 space-y-1 text-sm text-muted-foreground"><p>{snapshot.index_name ?? "KSE-100"} {snapshot.index_value !== null ? `closed at ${snapshot.index_value.toLocaleString("en-PK", { maximumFractionDigits: 2 })}` : "level is unavailable"}{snapshot.index_change_percent !== null ? `, ${fmtPct(snapshot.index_change_percent)}.` : "."}</p><p>{snapshot.total_advancers} of {breadthTotal} traded stocks advanced, while {snapshot.total_decliners} declined.</p>{strongest && <p>{strongest.sector} was the strongest sector at {fmtPct(strongest.average_return)}.</p>}{weakest && <p>{weakest.sector} was the weakest sector at {fmtPct(weakest.average_return)}.</p>}{foreignFlow && <p>Foreign investors recorded net {foreignFlow.day.fipiNet !== null && foreignFlow.day.fipiNet >= 0 ? "buying" : "selling"} of {foreignFlow.day.currency} {Math.abs(foreignFlow.day.fipiNet ?? 0).toFixed(1)}M based on the latest flow data for {foreignFlow.day.date}.</p>}</div></section>

      <MarketPulseWorkspace sectors={market.sectors} heatmap={market.heatmap} movers={market.movers} events={market.events} owned={[...market.ownedTickers]} watched={[...market.watchTickers]} foreignFlow={foreignFlow} flowHistory={flowHistory} />

      <p className="text-center text-[10px] text-muted-foreground">Source: official PSX market-watch and index feeds via {snapshot.source_provider} · snapshot {snapshot.snapshot_date} · traded value is volume × price where applicable.</p>
    </div>
  );
}

function MarketStat({ label, value, tone: statTone }: { label: string; value: string; tone?: "positive" | "negative" }) { return <div><p className={cn("text-sm font-semibold tabular-nums", statTone === "positive" ? "text-emerald-700" : statTone === "negative" ? "text-red-700" : "text-foreground")}>{value}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p></div>; }

function RelativeList({ title, rows }: { title: string; rows: { ticker: string; change_percent: number | null; sector: string | null; vsSector: number | null }[] }) { return <div className="mt-5"><p className="text-xs font-semibold">{title}</p>{rows.length ? <div className="mt-2 divide-y divide-border">{rows.map((row) => <Link key={row.ticker} href={`/stocks/${row.ticker}`} className="grid grid-cols-[4rem_1fr_auto] gap-2 py-2 text-xs hover:bg-muted/30"><span className="font-semibold">{row.ticker}</span><span className="text-muted-foreground">{fmtPct(row.change_percent)} · {row.sector ?? "Unclassified"}</span><span className={cn("font-medium tabular-nums", (row.vsSector ?? 0) > 0 ? "text-emerald-700" : "text-red-700")}>{fmtPct(row.vsSector)} vs sector</span></Link>)}</div> : <p className="mt-2 text-xs text-muted-foreground">No comparable sector data.</p>}</div>; }

function PortfolioFlows({ rows, flowDate, unit }: { rows: { sector: string; flowNet: number | null; portfolioWeight: number; tickers: string[] }[]; flowDate: string | null; unit: string }) { return <div><h3 className="text-sm font-semibold">Foreign Flows in My Portfolio Sectors</h3><p className="mt-1 text-[11px] text-muted-foreground">Sector-level investor-flow data; it does not indicate trading in individual holdings.</p><div className="mt-3 divide-y divide-border">{rows.length ? rows.slice(0, 4).map((row) => <div key={row.sector} className="py-2 text-xs"><div className="flex justify-between gap-3"><span className="font-medium">{row.sector}</span><span className={cn("tabular-nums font-medium", (row.flowNet ?? 0) > 0 ? "text-emerald-700" : (row.flowNet ?? 0) < 0 ? "text-red-700" : "")}>{row.flowNet !== null ? `${row.flowNet > 0 ? "+" : ""}${row.flowNet.toFixed(1)} ${unit}` : "—"}</span></div><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{row.tickers.join(", ")} · {row.portfolioWeight.toFixed(1)}%</p></div>) : <p className="py-4 text-xs text-muted-foreground">No matching sector flow data.</p>}</div>{flowDate && <p className="mt-2 text-[10px] text-muted-foreground">Flow reporting date: {flowDate}</p>}</div>; }

function RelevantEvents({ events }: { events: { ticker: string; title: string; event_type: string; event_date: string }[] }) { return <div><h3 className="text-sm font-semibold">Relevant filings</h3><p className="mt-1 text-[11px] text-muted-foreground">Official filings for your holdings today.</p><div className="mt-3 divide-y divide-border">{events.length ? events.slice(0, 4).map((event) => <div key={`${event.ticker}-${event.title}`} className="py-2 text-xs"><p className="font-medium">{event.ticker} · {event.event_type.replace(/_/g, " ")}</p><p className="mt-0.5 line-clamp-2 text-muted-foreground">{event.title}</p></div>) : <p className="py-4 text-xs text-muted-foreground">No held-stock filings in this snapshot.</p>}</div></div>; }
