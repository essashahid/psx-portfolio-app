import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read model for the Stock Research screener. One cached read returns the whole
 * traded market (from the latest market snapshot) joined with compact sparkline
 * series (company_technicals.spark) and the user's ownership/watchlist sets.
 * The page hands this to a client component that sorts/filters/searches entirely
 * in memory — no refetch, instant interaction.
 */

export interface ScreenerStock {
  ticker: string;
  companyName: string | null;
  sector: string | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  valueTraded: number | null;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  nearHigh: boolean;
  nearLow: boolean;
  unusualVolume: boolean;
  spark: number[] | null;
  owned: boolean;
  watched: boolean;
}

export interface ScreenerData {
  stocks: ScreenerStock[];
  sectors: string[];
  snapshotDate: string | null;
  updatedLabel: string | null;
  source: string | null;
  index: { name: string | null; value: number | null; changePercent: number | null } | null;
  breadth: { advancers: number; decliners: number; unchanged: number } | null;
  coverage: { total: number; withSpark: number };
}

export async function getScreenerData(supabase: SupabaseClient, userId: string): Promise<ScreenerData> {
  const { data: snap } = await supabase
    .from("market_snapshots")
    .select("id, snapshot_date, snapshot_time, source_provider, index_name, index_value, index_change_percent, total_advancers, total_decliners, total_unchanged")
    .eq("market", "PSX")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [{ data: holdings }, { data: watch }] = await Promise.all([
    supabase.from("holdings").select("ticker").eq("user_id", userId).gt("quantity", 0),
    supabase.from("stock_watchlist").select("ticker").eq("user_id", userId),
  ]);
  const owned = new Set((holdings ?? []).map((h) => (h.ticker as string).toUpperCase()));
  const watched = new Set((watch ?? []).map((w) => (w.ticker as string).toUpperCase()));

  if (!snap) {
    return { stocks: [], sectors: [], snapshotDate: null, updatedLabel: null, source: null, index: null, breadth: null, coverage: { total: 0, withSpark: 0 } };
  }

  const { data: items } = await supabase
    .from("market_snapshot_items")
    .select("ticker, company_name, sector, price, change, change_percent, open, high, low, volume, value_traded, market_cap, fifty_two_week_high, fifty_two_week_low, near_high, near_low, unusual_volume")
    .eq("snapshot_id", snap.id);

  const rows = items ?? [];
  const tickers = rows.map((r) => r.ticker as string);

  // Sparklines for the whole set in chunked reads (small column).
  const sparkByTicker = new Map<string, number[]>();
  for (let i = 0; i < tickers.length; i += 500) {
    const { data: sparks } = await supabase
      .from("company_technicals")
      .select("ticker, spark")
      .in("ticker", tickers.slice(i, i + 500));
    for (const s of sparks ?? []) {
      if (Array.isArray(s.spark) && s.spark.length > 1) sparkByTicker.set((s.ticker as string).toUpperCase(), s.spark as number[]);
    }
  }

  const stocks: ScreenerStock[] = rows.map((r) => {
    const ticker = (r.ticker as string).toUpperCase();
    return {
      ticker,
      companyName: r.company_name,
      sector: r.sector,
      price: r.price,
      change: r.change,
      changePercent: r.change_percent,
      open: r.open,
      high: r.high,
      low: r.low,
      volume: r.volume,
      valueTraded: r.value_traded,
      marketCap: r.market_cap,
      fiftyTwoWeekHigh: r.fifty_two_week_high,
      fiftyTwoWeekLow: r.fifty_two_week_low,
      nearHigh: r.near_high,
      nearLow: r.near_low,
      unusualVolume: r.unusual_volume,
      spark: sparkByTicker.get(ticker) ?? null,
      owned: owned.has(ticker),
      watched: watched.has(ticker),
    };
  });

  // Default order: most actively traded first (value), so the page opens on signal.
  stocks.sort((a, b) => (b.valueTraded ?? 0) - (a.valueTraded ?? 0));

  const sectors = [...new Set(stocks.map((s) => s.sector).filter((x): x is string => !!x))].sort();
  const updatedLabel = snap.snapshot_time
    ? new Date(snap.snapshot_time).toLocaleString("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" })
    : null;

  return {
    stocks,
    sectors,
    snapshotDate: snap.snapshot_date,
    updatedLabel,
    source: snap.source_provider,
    index: { name: snap.index_name, value: snap.index_value, changePercent: snap.index_change_percent },
    breadth: { advancers: snap.total_advancers, decliners: snap.total_decliners, unchanged: snap.total_unchanged },
    coverage: { total: stocks.length, withSpark: sparkByTicker.size },
  };
}
