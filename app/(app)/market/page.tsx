import { createClient, getUser } from "@/lib/supabase/server";
import { getMarketDashboard } from "@/lib/market/read";
import { getForeignFlowSnapshot } from "@/lib/market/foreign-flows";
import { fmtCompact, fmtInt, fmtPct, tone } from "@/lib/market/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Band } from "@/components/ui/band";
import { AsOf } from "@/components/shared/as-of";
import {
  BreadthStrip,
  FiftyTwoWeekStrip,
  SectorTileBoard,
  ReturnHistogram,
  ParticipantFlowBar,
  MarketInternals,
  type Gauge,
} from "@/components/features/market/market-pulse-visuals";
import { Activity, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/shared/format";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** Thirty-day averages of traded volume and value, for the internals gauges. */
async function getThirtyDayAverages(supabase: SupabaseClient): Promise<{ volume: number | null; value: number | null }> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("market_snapshots")
    .select("total_volume, total_value")
    .eq("market", "PSX")
    .gte("snapshot_date", since);
  if (!data || data.length === 0) return { volume: null, value: null };
  const vols = data.map((r) => Number(r.total_volume)).filter((v) => v > 0);
  const vals = data.map((r) => Number(r.total_value)).filter((v) => v > 0);
  return {
    volume: vols.length ? vols.reduce((n, v) => n + v, 0) / vols.length : null,
    value: vals.length ? vals.reduce((n, v) => n + v, 0) / vals.length : null,
  };
}

/** 52-week band for the index, from the stored KSE100 price history. */
async function getIndexYearRange(supabase: SupabaseClient): Promise<{ low: number; high: number; prevClose: number | null } | null> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("company_price_history")
    .select("close, price_date")
    .eq("ticker", "KSE100")
    .gte("price_date", since)
    .order("price_date", { ascending: true });
  if (!data || data.length < 2) return null;
  const closes = data.map((r) => Number(r.close)).filter((v) => v > 0);
  if (closes.length < 2) return null;
  return {
    low: Math.min(...closes),
    high: Math.max(...closes),
    prevClose: closes.at(-2) ?? null,
  };
}

export default async function MarketPulsePage() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  // allowStale: the design always draws the participation band, so render the
  // most recent flow day we hold and label its age rather than showing nothing.
  const foreignFlow = await getForeignFlowSnapshot(supabase, 90, { allowStale: true });
  const [market, yearRange, averages] = await Promise.all([
    getMarketDashboard(supabase, user.id),
    getIndexYearRange(supabase),
    getThirtyDayAverages(supabase),
  ]);

  if (!market.snapshot) {
    return <div className="space-y-6"><header><p className="eyebrow">PSX · Market Pulse</p><h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Market Pulse</h1></header><EmptyState icon={Activity} title="No market snapshot yet" description="Refresh the PSX market snapshot to load breadth, sector and mover data." /></div>;
  }

  const snapshot = market.snapshot;
  const ratio = snapshot.total_decliners ? snapshot.total_advancers / snapshot.total_decliners : snapshot.total_advancers;
  const indexTone = tone(snapshot.index_change_percent);
  const leaders = market.sectors.filter((sector) => sector.average_return !== null).sort((a, b) => (b.average_return ?? 0) - (a.average_return ?? 0));

  // Design-band inputs, all derived from the snapshot already in hand.
  const ownedSectors = new Set(market.owned.map((h) => h.sector).filter(Boolean));
  const marketValueTotal = market.sectors.reduce((n, s) => n + (s.total_value ?? 0), 0);
  const sectorTiles = leaders.map((s) => ({
    sector: s.sector,
    ret: s.average_return ?? 0,
    weight: marketValueTotal > 0 ? ((s.total_value ?? 0) / marketValueTotal) * 100 : null,
    owned: ownedSectors.has(s.sector),
  }));
  const histogramChanges = market.heatmap
    .filter((item) => item.change_percent !== null)
    .map((item) => ({ ticker: item.ticker, pct: Number(item.change_percent) }));
  // Each gauge scales so the reference (30-day average, or parity) sits at a
  // fixed tick and today's reading fills against it.
  const ratioValue = ratio;
  const highs = market.heatmap.filter((i) => i.near_high).length;
  const lows = market.heatmap.filter((i) => i.near_low).length;
  const against = (today: number, avg: number | null) => {
    if (!avg || avg <= 0) return { fill: 60, mark: 60, delta: "no history", tone: "flat" as const, note: "30-day average unavailable" };
    const scale = Math.max(today, avg) * 1.25;
    const pctDelta = ((today - avg) / avg) * 100;
    return {
      fill: (today / scale) * 100,
      mark: (avg / scale) * 100,
      delta: `${pctDelta < 0 ? "−" : "+"}${Math.abs(pctDelta).toFixed(0)}%`,
      tone: (pctDelta >= 0 ? "up" : "down") as "up" | "down",
      note: `30-day average ${fmtCompact(avg)}`,
    };
  };
  const volumeGauge = against(snapshot.total_volume, averages.volume);
  const valueGauge = against(snapshot.total_value, averages.value);
  const gauges: Gauge[] = [
    { label: "Volume", value: `${fmtCompact(snapshot.total_volume)} shares`, ...volumeGauge },
    { label: "Value traded", value: `${fmtCompact(snapshot.total_value)} PKR`, ...valueGauge },
    {
      label: "Advance-decline",
      value: ratioValue.toFixed(2),
      delta: `${snapshot.total_advancers} to ${snapshot.total_decliners}`,
      fill: (snapshot.total_advancers / (snapshot.total_advancers + snapshot.total_decliners || 1)) * 100,
      mark: 50,
      tone: ratioValue >= 1 ? "up" : "down",
      note: `${fmtInt(snapshot.item_count)} companies traded`,
    },
    {
      label: "52-week highs",
      value: String(highs),
      delta: `${lows} low${lows === 1 ? "" : "s"}`,
      fill: (highs / (highs + lows || 1)) * 100,
      mark: 50,
      tone: highs >= lows ? "up" : "down",
      note: "new extremes today",
    },
  ];

  const participantRows = [
    ...(foreignFlow && foreignFlow.day.fipiNet !== null ? [{ label: "Foreign investors", net: foreignFlow.day.fipiNet }] : []),
    ...(foreignFlow?.participants ?? []).map((p) => ({ label: p.label, net: p.net })),
  ].filter((r): r is { label: string; net: number } => r.net !== null);

  return (
    <div className="settle -mx-3 sm:-mx-4 md:-mx-(--gutter-page)">
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)" style={{ background: "color-mix(in oklab, var(--sp-plum) 15%, var(--surface-page))" }}>
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-(--sp-plum)" />
            <h1 className="font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Market Pulse</h1>
            <div className="mt-4 flex items-end gap-5">
              <span>
                <span className="block text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{snapshot.index_name ?? "KSE-100"}</span>
                <span className="figure mt-1.5 block text-(length:--text-display) font-semibold leading-none tracking-editorial text-text-strong">
                  {snapshot.index_value?.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}
                </span>
              </span>
              <span className="pb-1.5">
                <span className={cn("figure flex items-center gap-1 text-(length:--text-h2) font-semibold", indexTone === "positive" ? "text-up" : indexTone === "negative" ? "text-down" : "text-text-muted")}>
                  {indexTone === "positive" ? <ArrowUpRight className="h-4 w-4" /> : indexTone === "negative" ? <ArrowDownRight className="h-4 w-4" /> : null}
                  {fmtInt(snapshot.index_change)}
                </span>
                <span className="figure mt-0.5 block text-sm text-text-muted">{fmtPct(snapshot.index_change_percent)}</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3 pb-1">
            <AsOf date={snapshot.snapshot_date} time={snapshot.snapshot_time} label="Prices" />
          </div>
        </div>

        <div className="mt-7 grid gap-13 border-t border-rule pt-6 lg:grid-cols-2">
          <BreadthStrip advancers={snapshot.total_advancers} unchanged={snapshot.total_unchanged} decliners={snapshot.total_decliners} />
          {yearRange && snapshot.index_value !== null ? (
            <FiftyTwoWeekStrip low={yearRange.low} high={yearRange.high} prevClose={yearRange.prevClose} last={snapshot.index_value} />
          ) : (
            <div>
              <p className="eyebrow">Market activity</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MarketStat label="Volume" value={fmtCompact(snapshot.total_volume)} />
                <MarketStat label="Value" value={`PKR ${fmtCompact(snapshot.total_value)}`} />
                <MarketStat label="Most active" value={snapshot.most_active_ticker ?? "—"} />
              </div>
            </div>
          )}
        </div>
      </Band>

      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
        <SectorTileBoard tiles={sectorTiles} />
      </Band>

      <Band tone="paper" className="dot-grid px-3 sm:px-4 md:px-(--gutter-page)">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">Distribution</p>
            <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">How the whole market traded</h2>
          </div>
          <span className="flex flex-wrap gap-5">
            <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="h-2.75 w-2.75 bg-(--up-1)" /><span className="text-xs text-text-muted">Companies that rose</span></span>
            <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="h-2.75 w-2.75 bg-(--down-1)" /><span className="text-xs text-text-muted">Companies that fell</span></span>
            <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="h-2.75 w-2.75 bg-(--sp-plum)" /><span className="text-xs text-text-muted">Your holdings</span></span>
          </span>
        </div>
        <ReturnHistogram changes={histogramChanges} ownedTickers={[...market.ownedTickers]} />
      </Band>

      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Participation</p>
            <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">Whose money changed hands</h2>
          </div>
          {foreignFlow?.day.date && (
            <span className="figure text-(length:--text-2xs) text-text-faint">
              flow data {foreignFlow.day.date}{foreignFlow.day.isStale && foreignFlow.day.ageDays !== null ? ` · ${foreignFlow.day.ageDays} days old` : ""}
            </span>
          )}
        </div>
        {participantRows.length > 0 ? (
          <ParticipantFlowBar rows={participantRows} unit={foreignFlow ? `${foreignFlow.day.currency} mn` : "mn"} />
        ) : (
          <p className="max-w-(--measure) py-4 text-sm text-text-muted">
            No investor-flow data is stored for the recent window.
          </p>
        )}

        <MarketInternals gauges={gauges} />
      </Band>

    </div>
  );
}

function MarketStat({ label, value, tone: statTone }: { label: string; value: string; tone?: "positive" | "negative" }) { return <div><p className={cn("text-sm font-semibold tabular-nums", statTone === "positive" ? "text-up" : statTone === "negative" ? "text-down" : "text-foreground")}>{value}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p></div>; }



