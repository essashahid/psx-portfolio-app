import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { getMarketDashboard } from "@/lib/market/read";
import { sectorColor, shortSector } from "@psx/shared/sector-colors";
import type { MarketMover, MarketResponse, MarketSector } from "@psx/shared/api/market";

/**
 * The market snapshot for the mobile Market tab.
 *
 * getMarketDashboard() is what the web market page reads, so the index level,
 * breadth and sector table are computed once. Only the fields the phone draws
 * are forwarded; the heatmap and the generated brief stay on the desk.
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
      gainers: (dashboard.movers.gainers ?? []).map(toMover).slice(0, 8),
      losers: (dashboard.movers.losers ?? []).map(toMover).slice(0, 8),
      mostActive: (dashboard.movers.most_active ?? dashboard.movers.volume ?? []).map(toMover).slice(0, 8),
      updatedLabel: dashboard.updatedLabel,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
