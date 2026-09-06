import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { getMarketDashboard, type EventRow, type MoverRow } from "@/lib/market/read";
import { getForeignFlowSnapshot } from "@/lib/market/foreign-flows";
import { getDailyHoldingPerformance, type DailyHoldingPerformanceRow } from "@/lib/portfolio/daily-performance";
import { marketVerdict, type SummaryRow } from "@/lib/market/summary";
import { fmtCompact, fmtInt, fmtPct, tone } from "@/lib/market/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Band } from "@/components/ui/band";
import { Metric } from "@/components/ui/metric";
import { PanelHeader } from "@/components/ui/panel-header";
import { AsOf } from "@/components/shared/as-of";
import { SectorChip } from "@/components/shared/sector-chip";
import { MoreDetail } from "@/components/features/market/more-detail";
import {
  BreadthStrip,
  FiftyTwoWeekStrip,
  SectorTileBoard,
  ReturnHistogram,
  ParticipantFlowBar,
  MarketInternals,
  type Gauge,
} from "@/components/features/market/market-pulse-visuals";
import { Activity } from "lucide-react";
import { cn, formatNumber, formatSignedPct } from "@/lib/shared/format";
import { shortSector } from "@/lib/shared/sector-colors";
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

const MOVER_LIMIT = 5;
const DEVELOPMENT_LIMIT = 5;

export default async function MarketPulsePage() {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  // allowStale: the participation band always draws, so render the most
  // recent flow day we hold and label its age rather than showing nothing.
  const foreignFlow = await getForeignFlowSnapshot(supabase, 90, { allowStale: true });
  const [market, yearRange, averages, daily] = await Promise.all([
    getMarketDashboard(supabase, user.id),
    getIndexYearRange(supabase),
    getThirtyDayAverages(supabase),
    getDailyHoldingPerformance(supabase, user.id).catch(() => null),
  ]);

  if (!market.snapshot) {
    return <div className="space-y-6"><header><p className="eyebrow">PSX · Today</p><h1 className="mt-1.5 font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Market</h1></header><EmptyState icon={Activity} title="No market snapshot yet" description="Refresh the PSX market snapshot to load breadth, sector and mover data." /></div>;
  }

  const snapshot = market.snapshot;
  const ratio = snapshot.total_decliners ? snapshot.total_advancers / snapshot.total_decliners : snapshot.total_advancers;
  const indexTone = tone(snapshot.index_change_percent);
  const leaders = market.sectors.filter((sector) => sector.average_return !== null).sort((a, b) => (b.average_return ?? 0) - (a.average_return ?? 0));

  // The day in one sentence, from the same helper the phone's API uses.
  const summaryRows: SummaryRow[] = market.heatmap
    .filter((r) => Number(r.market_cap) > 0)
    .map((r) => ({
      ticker: r.ticker,
      name: r.company_name,
      sectorLabel: shortSector(r.sector),
      changePct: r.change_percent,
      marketCap: Number(r.market_cap),
    }));
  const verdict = marketVerdict(summaryRows);

  const gainers = (market.movers.gainers ?? []).slice(0, MOVER_LIMIT);
  const losers = (market.movers.losers ?? []).slice(0, MOVER_LIMIT);
  const holdingRows = (daily?.rows ?? []).filter((row) => row.dayChangePct !== null).sort((a, b) => (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0));
  const developments = market.events.slice(0, DEVELOPMENT_LIMIT);

  // Inputs for the fold, all derived from the snapshot already in hand.
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
      value: ratio.toFixed(2),
      delta: `${snapshot.total_advancers} to ${snapshot.total_decliners}`,
      fill: (snapshot.total_advancers / (snapshot.total_advancers + snapshot.total_decliners || 1)) * 100,
      mark: 50,
      tone: ratio >= 1 ? "up" : "down",
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
      {/* 1. The index, today's change, and when the prices are from. */}
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)" style={{ background: "color-mix(in oklab, var(--sp-plum) 15%, var(--surface-page))" }}>
        <div className="flex flex-wrap items-end justify-between gap-7">
          <div>
            <span className="mb-3.5 block h-0.75 w-11 bg-(--sp-plum)" />
            <h1 className="font-display text-(length:--text-title) font-normal tracking-editorial text-text-strong">Market</h1>
            <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
              <Metric
                label={snapshot.index_name ?? "KSE-100"}
                value={snapshot.index_value !== null ? formatNumber(snapshot.index_value, 2) : "—"}
              />
              <Metric
                label="Today"
                value={`${snapshot.index_change !== null && snapshot.index_change > 0 ? "+" : ""}${fmtInt(snapshot.index_change)}`}
                sub={fmtPct(snapshot.index_change_percent)}
                tone={indexTone === "positive" ? "up" : indexTone === "negative" ? "down" : undefined}
              />
            </div>
          </div>
          <div className="flex flex-col items-end gap-3 pb-1">
            <AsOf date={snapshot.snapshot_date} time={snapshot.snapshot_time} label="Delayed prices, as of" live />
          </div>
        </div>

        {/* 2. The day in one sentence. */}
        {verdict && (
          <p className="mt-6 max-w-(--measure) border-t border-rule pt-5 text-base leading-relaxed text-text-strong">{verdict}</p>
        )}
      </Band>

      {/* 3. Sectors today, best first. */}
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
        <SectorTileBoard tiles={sectorTiles} />
      </Band>

      {/* 4. Major movers. */}
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
        <PanelHeader eyebrow="Movers" title="Biggest moves today" />
        <div className="mt-2 grid gap-x-12 gap-y-6 md:grid-cols-2">
          <MoverList title="Gainers" rows={gainers} ownedTickers={market.ownedTickers} />
          <MoverList title="Losers" rows={losers} ownedTickers={market.ownedTickers} />
        </div>
      </Band>

      {/* 5. Your holdings against the market. */}
      {holdingRows.length > 0 && (
        <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
          <PanelHeader
            eyebrow="Your book"
            title="Your holdings today"
            aside={
              daily?.weightedDayChangePct !== null && daily?.weightedDayChangePct !== undefined ? (
                <span className="text-sm text-text-muted">
                  Portfolio{" "}
                  <span className={cn("figure font-semibold", daily.weightedDayChangePct > 0 ? "text-up" : daily.weightedDayChangePct < 0 ? "text-down" : "text-text-strong")}>
                    {formatSignedPct(daily.weightedDayChangePct, 2)}
                  </span>{" "}
                  against the index at{" "}
                  <span className="figure font-semibold text-text-strong">{formatSignedPct(snapshot.index_change_percent, 2)}</span>
                </span>
              ) : undefined
            }
          />
          <HoldingsToday rows={holdingRows} indexPct={snapshot.index_change_percent} />
        </Band>
      )}

      {/* 6. Market developments. */}
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
        <PanelHeader
          eyebrow="Developments"
          title="Market developments"
          aside={<Link href="/news?tab=market" className="text-xs font-medium text-text-muted hover:text-text-strong">All market news</Link>}
        />
        {developments.length > 0 ? (
          <Developments rows={developments} ownedTickers={market.ownedTickers} />
        ) : (
          <p className="max-w-(--measure) py-4 text-sm text-text-muted">No company announcements were recorded for this session yet.</p>
        )}
      </Band>

      {/* 7. Everything else, folded away. */}
      <Band tone="paper" className="px-3 sm:px-4 md:px-(--gutter-page)">
        <MoreDetail>
          <div className="grid gap-13 lg:grid-cols-2">
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

          <div className="dot-grid mt-12">
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
          </div>

          <div className="mt-12">
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
          </div>
        </MoreDetail>
      </Band>
    </div>
  );
}

function pctClass(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-text-muted";
  return value > 0 ? "text-up" : value < 0 ? "text-down" : "text-text-muted";
}

/** Five names, one per line: company, ticker, price and the day's move. */
function MoverList({ title, rows, ownedTickers }: { title: string; rows: MoverRow[]; ownedTickers: Set<string> }) {
  return (
    <div>
      <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Nothing recorded for this session.</p>
      ) : (
        <ol className="mt-2 divide-y divide-rule">
          {rows.map((row) => (
            <li key={`${title}-${row.ticker}`} className="flex items-center gap-4 py-2.5">
              <Link href={`/stocks/${row.ticker}`} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-sm font-medium text-text-strong">{row.company_name ?? row.ticker}</span>
                <span className="mt-0.5 block text-(length:--text-2xs) text-text-muted">
                  {row.ticker}
                  {ownedTickers.has(row.ticker) ? ", in your book" : ""}
                </span>
              </Link>
              <span className="figure w-20 shrink-0 text-right text-sm text-text-strong">{row.price !== null ? formatNumber(row.price, 2) : "—"}</span>
              <span className={cn("figure w-16 shrink-0 text-right text-sm font-semibold", pctClass(row.change_percent))}>{formatSignedPct(row.change_percent, 2)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Each held ticker's day move, and how that compares with the index and its sector. */
function HoldingsToday({ rows, indexPct }: { rows: DailyHoldingPerformanceRow[]; indexPct: number | null }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
            <th className="py-2 text-left font-bold">Holding</th>
            <th className="py-2 text-right font-bold">Today</th>
            <th className="py-2 text-right font-bold">Against the index</th>
            <th className="hidden py-2 text-right font-bold sm:table-cell">Against its sector</th>
            <th className="hidden py-2 text-right font-bold md:table-cell">Day P/L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((row) => {
            const vsIndex = row.dayChangePct !== null && indexPct !== null ? row.dayChangePct - indexPct : null;
            return (
              <tr key={row.ticker}>
                <td className="py-2.5 pr-4">
                  <Link href={`/stocks/${row.ticker}`} className="hover:underline">
                    <span className="block font-medium text-text-strong">{row.ticker}</span>
                    <span className="block truncate text-(length:--text-2xs) text-text-muted">{row.companyName ?? ""}</span>
                  </Link>
                </td>
                <td className={cn("figure py-2.5 text-right font-semibold", pctClass(row.dayChangePct))}>{formatSignedPct(row.dayChangePct, 2)}</td>
                <td className={cn("figure py-2.5 text-right", pctClass(vsIndex))}>{vsIndex !== null ? `${formatSignedPct(vsIndex, 2)} pts` : "—"}</td>
                <td className="hidden py-2.5 text-right sm:table-cell">
                  <span className={cn("figure", pctClass(row.vsSectorPct))}>{row.vsSectorPct !== null ? `${formatSignedPct(row.vsSectorPct, 2)} pts` : "—"}</span>
                  {row.sector && <SectorChip sector={row.sector} size="xs" className="ml-2 hidden lg:inline-flex" />}
                </td>
                <td className={cn("figure hidden py-2.5 text-right md:table-cell", pctClass(row.dayPnl))}>
                  {row.dayPnl !== null ? `${row.dayPnl > 0 ? "+" : ""}${formatNumber(row.dayPnl, 0)}` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The latest company announcements from the exchange for this session. */
function Developments({ rows, ownedTickers }: { rows: EventRow[]; ownedTickers: Set<string> }) {
  return (
    <ol className="mt-2 divide-y divide-rule">
      {rows.map((row) => {
        const time = row.event_time ? row.event_time.slice(0, 5) : null;
        return (
          <li key={`${row.ticker}-${row.title}-${row.event_time ?? ""}`} className="flex items-start gap-4 py-3">
            <span className="figure w-12 shrink-0 pt-0.5 text-(length:--text-2xs) text-text-muted">{time ?? ""}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug text-text-strong">
                {row.source_url ? (
                  <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">{row.title}</a>
                ) : (
                  row.title
                )}
              </p>
              <p className="mt-0.5 text-(length:--text-2xs) text-text-muted">
                <Link href={`/stocks/${row.ticker}`} className="font-medium text-text-strong hover:underline">{row.ticker}</Link>
                {row.company_name ? `, ${row.company_name}` : ""}
                {ownedTickers.has(row.ticker) ? ", in your book" : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function MarketStat({ label, value, tone: statTone }: { label: string; value: string; tone?: "positive" | "negative" }) { return <div><p className={cn("text-sm font-semibold tabular-nums", statTone === "positive" ? "text-up" : statTone === "negative" ? "text-down" : "text-text-strong")}>{value}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-text-muted">{label}</p></div>; }
