import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getMarketDashboard } from "@/lib/market/read";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import { buildReturnDistribution } from "@psx/shared/market/return-distribution";
import { getForeignFlowSnapshot } from "@/lib/market/foreign-flows";
import type {
  MarketFlow,
  MarketMapItem,
  MarketMover,
  MarketResponse,
  MarketSector,
} from "@psx/shared/api/market";

/**
 * How many companies the map draws.
 *
 * The snapshot holds 150. A treemap on a phone stops being readable well
 * before that: past roughly fifty the tail is tiles too small to carry a
 * ticker, which is noise rather than information. The caption states what the
 * shown tiles are worth against the whole market, so the omission is visible.
 */
const MAP_LIMIT = 50;

/**
 * The market snapshot for the mobile Market tab.
 *
 * getMarketDashboard() is what the web market page reads, so the index level,
 * breadth and sector table are computed once. Only the fields the phone draws
 * are forwarded. The heatmap is ~500 rows, so it is bucketed here rather than
 * shipped: the phone draws twelve bars from it. The generated brief stays on
 * the desk.
 */
export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const dashboard = await getMarketDashboard(supabase, user.id);
    const snapshot = dashboard.snapshot;

    const toMover = (row: {
      ticker: string;
      company_name: string | null;
      sector: string | null;
      price: number | null;
      change_percent: number | null;
      volume: number | null;
    }): MarketMover => ({
      ticker: row.ticker,
      companyName: row.company_name,
      sector: row.sector,
      color: sectorColor(row.sector),
      price: row.price,
      changePct: row.change_percent,
      volume: row.volume,
      owned: dashboard.ownedTickers.has(row.ticker),
    });

    // Area is market cap, so a row without one cannot be placed at all.
    const priced = dashboard.heatmap.filter((r) => Number(r.market_cap) > 0);
    const capTotal = priced.reduce((n, r) => n + Number(r.market_cap), 0);
    const mapRows = [...priced]
      .sort((a, b) => Number(b.market_cap) - Number(a.market_cap))
      .slice(0, MAP_LIMIT);
    const map: MarketMapItem[] = mapRows.map((r) => ({
      ticker: r.ticker,
      sector: r.sector,
      sectorLabel: shortSector(r.sector),
      color: sectorColor(r.sector),
      changePct: r.change_percent,
      marketCap: Number(r.market_cap),
      owned: dashboard.ownedTickers.has(r.ticker),
    }));
    const capShown = mapRows.reduce((n, r) => n + Number(r.market_cap), 0);

    // Who was buying. Absent for a day the tape has not landed yet, in which
    // case the section simply does not render.
    let flows: MarketFlow[] = [];
    let flowsAsOf: string | null = null;
    try {
      const snap = await getForeignFlowSnapshot(supabase, 1, { allowStale: true });
      if (snap) {
        flowsAsOf = snap.day.date;
        flows = [
          { label: "Foreign investors", net: snap.day.fipiNet },
          ...snap.participants.slice(0, 4).map((p) => ({ label: p.label, net: p.net })),
        ];
      }
    } catch {
      // A missing flow tape must not take the whole market screen down.
    }

    const sectors: MarketSector[] = dashboard.sectors
      .map((s) => ({
        sector: s.sector,
        label: shortSector(s.sector),
        color: sectorColor(s.sector),
        averageReturn: s.average_return,
        advancers: s.advancers,
        decliners: s.decliners,
        stockCount: s.stock_count,
        topGainer: s.top_gainer,
        topGainerPct: s.top_gainer_pct,
      }))
      .sort((a, b) => (b.averageReturn ?? 0) - (a.averageReturn ?? 0));

    const body: MarketResponse = {
      index: snapshot
        ? {
            name: snapshot.index_name ?? "KSE-100",
            value: snapshot.index_value,
            change: snapshot.index_change,
            changePct: snapshot.index_change_percent,
            asOf: snapshot.snapshot_time ?? snapshot.snapshot_date,
            source: snapshot.source_provider,
          }
        : null,
      breadth: snapshot
        ? {
            advancers: snapshot.total_advancers,
            decliners: snapshot.total_decliners,
            unchanged: snapshot.total_unchanged,
            totalVolume: snapshot.total_volume,
            totalValue: snapshot.total_value,
          }
        : null,
      sectors,
      map,
      mapCoverage: { shown: mapRows.length, total: priced.length, capShown, capTotal },
      flows,
      flowsAsOf,
      gainers: (dashboard.movers.gainers ?? []).map(toMover).slice(0, 8),
      losers: (dashboard.movers.losers ?? []).map(toMover).slice(0, 8),
      mostActive: (dashboard.movers.most_active ?? dashboard.movers.volume ?? []).map(toMover).slice(0, 8),
      distribution:
        dashboard.heatmap.length > 0
          ? buildReturnDistribution(
              dashboard.heatmap
                .filter((row) => row.change_percent !== null)
                .map((row) => ({ ticker: row.ticker, pct: Number(row.change_percent) })),
              dashboard.ownedTickers
            )
          : null,
      updatedLabel: dashboard.updatedLabel,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
