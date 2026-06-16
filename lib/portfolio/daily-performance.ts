import type { SupabaseClient } from "@supabase/supabase-js";

type HoldingRow = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  quantity: number | string;
  avg_cost: number | string | null;
  total_cost: number | string | null;
};

type QuoteRow = {
  ticker: string;
  price: number | string | null;
  prev_close: number | string | null;
  day_change: number | string | null;
  day_change_pct: number | string | null;
  volume: number | string | null;
  as_of: string | null;
};

type SnapshotItemRow = {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | string | null;
  previous_close: number | string | null;
  change: number | string | null;
  change_percent: number | string | null;
  volume: number | string | null;
  value_traded: number | string | null;
};

type SectorSnapshotRow = {
  sector: string;
  average_return: number | string | null;
};

export interface DailyHoldingPerformanceRow {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  quantity: number;
  avgCost: number | null;
  totalCost: number | null;
  price: number | null;
  prevClose: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  dayPnl: number | null;
  marketValue: number | null;
  weight: number | null;
  sectorAveragePct: number | null;
  vsSectorPct: number | null;
  volume: number | null;
  valueTraded: number | null;
}

export interface DailyHoldingPerformance {
  asOf: string | null;
  snapshotTime: string | null;
  rows: DailyHoldingPerformanceRow[];
  totalMarketValue: number;
  totalDayPnl: number | null;
  weightedDayChangePct: number | null;
  gainers: number;
  losers: number;
  unchanged: number;
  coverage: number;
  best: DailyHoldingPerformanceRow | null;
  worst: DailyHoldingPerformanceRow | null;
  biggestImpact: DailyHoldingPerformanceRow | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const upper = (v: string) => v.trim().toUpperCase();

function pctFrom(price: number | null, prevClose: number | null, change: number | null): number | null {
  if (prevClose && change !== null) return (change / prevClose) * 100;
  if (price !== null && prevClose) return ((price - prevClose) / prevClose) * 100;
  return null;
}

function changeFrom(price: number | null, prevClose: number | null, pct: number | null): number | null {
  if (price !== null && prevClose !== null) return price - prevClose;
  if (price !== null && pct !== null && pct !== -100) return price - price / (1 + pct / 100);
  return null;
}

export async function getDailyHoldingPerformance(
  supabase: SupabaseClient,
  userId: string
): Promise<DailyHoldingPerformance> {
  const { data: holdingsData } = await supabase
    .from("holdings")
    .select("ticker, company_name, sector, quantity, avg_cost, total_cost")
    .eq("user_id", userId)
    .gt("quantity", 0)
    .order("ticker");

  const holdings = (holdingsData ?? []) as HoldingRow[];
  const tickers = holdings.map((h) => upper(h.ticker));
  if (tickers.length === 0) {
    return {
      asOf: null,
      snapshotTime: null,
      rows: [],
      totalMarketValue: 0,
      totalDayPnl: null,
      weightedDayChangePct: null,
      gainers: 0,
      losers: 0,
      unchanged: 0,
      coverage: 0,
      best: null,
      worst: null,
      biggestImpact: null,
    };
  }

  const [{ data: snapshot }, { data: quotesData }] = await Promise.all([
    supabase
      .from("market_snapshots")
      .select("id, snapshot_date, snapshot_time")
      .eq("market", "PSX")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("market_quotes")
      .select("ticker, price, prev_close, day_change, day_change_pct, volume, as_of")
      .in("ticker", tickers),
  ]);

  const snapshotId = snapshot?.id as string | undefined;
  const [{ data: itemsData }, { data: sectorsData }] = snapshotId
    ? await Promise.all([
        supabase
          .from("market_snapshot_items")
          .select("ticker, company_name, sector, price, previous_close, change, change_percent, volume, value_traded")
          .eq("snapshot_id", snapshotId)
          .in("ticker", tickers),
        supabase.from("sector_snapshots").select("sector, average_return").eq("snapshot_id", snapshotId),
      ])
    : [{ data: null }, { data: null }];

  const quoteByTicker = new Map((quotesData ?? []).map((q) => [upper(q.ticker as string), q as QuoteRow]));
  const itemByTicker = new Map((itemsData ?? []).map((i) => [upper(i.ticker as string), i as SnapshotItemRow]));
  const sectorAverage = new Map(
    ((sectorsData ?? []) as SectorSnapshotRow[]).map((s) => [s.sector, num(s.average_return)])
  );

  const rows: DailyHoldingPerformanceRow[] = holdings.map((h) => {
    const ticker = upper(h.ticker);
    const item = itemByTicker.get(ticker);
    const quote = quoteByTicker.get(ticker);
    const quantity = num(h.quantity) ?? 0;
    const price = num(item?.price) ?? num(quote?.price);
    const prevClose = num(item?.previous_close) ?? num(quote?.prev_close);
    const directChange = num(item?.change) ?? num(quote?.day_change);
    const directPct = num(item?.change_percent) ?? num(quote?.day_change_pct);
    const dayChange = directChange ?? changeFrom(price, prevClose, directPct);
    const dayChangePct = directPct ?? pctFrom(price, prevClose, dayChange);
    const sector = item?.sector ?? h.sector ?? null;
    const sectorAveragePct = sector ? sectorAverage.get(sector) ?? null : null;
    const marketValue = price !== null ? price * quantity : null;
    const dayPnl = dayChange !== null ? dayChange * quantity : null;

    return {
      ticker,
      companyName: item?.company_name ?? h.company_name ?? null,
      sector,
      quantity,
      avgCost: num(h.avg_cost),
      totalCost: num(h.total_cost),
      price,
      prevClose,
      dayChange,
      dayChangePct,
      dayPnl,
      marketValue,
      weight: null,
      sectorAveragePct,
      vsSectorPct: dayChangePct !== null && sectorAveragePct !== null ? dayChangePct - sectorAveragePct : null,
      volume: num(item?.volume) ?? num(quote?.volume),
      valueTraded: num(item?.value_traded),
    };
  });

  const totalMarketValue = rows.reduce((sum, row) => sum + (row.marketValue ?? row.totalCost ?? 0), 0);
  for (const row of rows) {
    const value = row.marketValue ?? row.totalCost;
    row.weight = value !== null && totalMarketValue > 0 ? (value / totalMarketValue) * 100 : null;
  }

  const rowsWithPnl = rows.filter((row) => row.dayPnl !== null);
  const totalDayPnl = rowsWithPnl.length ? rowsWithPnl.reduce((sum, row) => sum + (row.dayPnl ?? 0), 0) : null;
  const weightedBase = rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
  const weightedDayChangePct =
    weightedBase > 0
      ? rows.reduce((sum, row) => sum + (row.dayChangePct !== null && row.marketValue !== null ? row.dayChangePct * row.marketValue : 0), 0) / weightedBase
      : null;

  const withPct = rows.filter((row) => row.dayChangePct !== null);
  const sortedByPct = [...withPct].sort((a, b) => (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0));
  const sortedByImpact = [...rowsWithPnl].sort((a, b) => Math.abs(b.dayPnl ?? 0) - Math.abs(a.dayPnl ?? 0));

  rows.sort((a, b) => Math.abs(b.dayPnl ?? 0) - Math.abs(a.dayPnl ?? 0) || (b.dayChangePct ?? 0) - (a.dayChangePct ?? 0));

  const quoteDates = (quotesData ?? []).map((q) => q.as_of as string | null).filter(Boolean) as string[];
  const asOf = (snapshot?.snapshot_date as string | undefined) ?? quoteDates.sort().at(-1) ?? null;

  return {
    asOf,
    snapshotTime: (snapshot?.snapshot_time as string | null | undefined) ?? null,
    rows,
    totalMarketValue,
    totalDayPnl,
    weightedDayChangePct,
    gainers: withPct.filter((row) => (row.dayChangePct ?? 0) > 0).length,
    losers: withPct.filter((row) => (row.dayChangePct ?? 0) < 0).length,
    unchanged: withPct.filter((row) => (row.dayChangePct ?? 0) === 0).length,
    coverage: rows.length ? withPct.length / rows.length : 0,
    best: sortedByPct[0] ?? null,
    worst: sortedByPct.at(-1) ?? null,
    biggestImpact: sortedByImpact[0] ?? null,
  };
}
