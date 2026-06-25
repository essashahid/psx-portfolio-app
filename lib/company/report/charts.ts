import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle } from "@/lib/company/types";
import { ensureEodCached, getCachedEod, KSE_SYMBOL } from "@/lib/market-data/eod-cache";

export interface PriceChartPoint {
  date: string;
  close: number;
  volume: number;
  kse100: number | null;
  kse100Indexed: number | null;
}

export interface TransactionMarker {
  date: string;
  price: number;
  quantity: number;
  type: string;
  label: string;
}

export interface PortfolioChartSeries {
  avgCost: number | null;
  markers: TransactionMarker[];
  runningQuantity: { date: string; quantity: number }[];
}

function indexSeries(baseDate: string, baseValue: number, points: { date: string; close: number }[]): Map<string, number> {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted.find((p) => p.date >= baseDate) ?? sorted[0];
  if (!start || start.close === 0) return new Map();
  const out = new Map<string, number>();
  for (const p of sorted) {
    out.set(p.date, (p.close / start.close) * baseValue);
  }
  return out;
}

export async function buildPriceChartWithBenchmark(
  supabase: SupabaseClient,
  ticker: string,
  candles: Candle[],
  years: number
): Promise<PriceChartPoint[]> {
  if (!candles.length) return [];

  const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const firstDate = new Date(latest.date);
  firstDate.setFullYear(firstDate.getFullYear() - years);
  const windowStart = firstDate.toISOString().slice(0, 10);
  const windowed = sorted.filter((c) => c.date >= windowStart);
  const sample = windowed.length ? windowed : sorted;

  await ensureEodCached([ticker]);
  const eod = await getCachedEod(supabase, [ticker]);
  const kseSeries = eod.get(KSE_SYMBOL) ?? [];
  const baseDate = sample[0]?.date ?? windowStart;
  const baseClose = sample[0]?.close ?? 100;
  const kseIndexed = indexSeries(baseDate, baseClose, kseSeries);

  const step = sample.length > 180 ? (sample.length - 1) / 179 : 1;
  const out: PriceChartPoint[] = [];
  for (let i = 0; i < Math.min(sample.length, 180); i++) {
    const c = sample[Math.round(i * step)];
    const kseRaw = kseSeries.find((k) => k.date === c.date)?.close ?? null;
    out.push({
      date: c.date,
      close: c.close,
      volume: c.volume,
      kse100: kseRaw,
      kse100Indexed: kseIndexed.get(c.date) ?? null,
    });
  }
  return out;
}

export async function buildTransactionMarkers(
  supabase: SupabaseClient,
  userId: string,
  ticker: string
): Promise<PortfolioChartSeries> {
  const { data: txns } = await supabase
    .from("transactions")
    .select("trade_date, type, quantity, price, net_amount")
    .eq("user_id", userId)
    .eq("ticker", ticker.toUpperCase())
    .in("type", ["BUY", "SELL", "BONUS", "RIGHT"])
    .order("trade_date", { ascending: true });

  const { data: holding } = await supabase
    .from("holdings")
    .select("quantity, avg_cost")
    .eq("user_id", userId)
    .eq("ticker", ticker.toUpperCase())
    .maybeSingle();

  const markers: TransactionMarker[] = (txns ?? []).map((t) => ({
    date: t.trade_date as string,
    price: Number(t.price) || 0,
    quantity: Number(t.quantity) || 0,
    type: t.type as string,
    label: `${t.type} ${t.quantity} @ ${t.price}`,
  }));

  let qty = 0;
  const runningQuantity: { date: string; quantity: number }[] = [];
  for (const t of txns ?? []) {
    const q = Number(t.quantity) || 0;
    if (t.type === "BUY" || t.type === "BONUS" || t.type === "RIGHT") qty += q;
    else if (t.type === "SELL") qty -= q;
    runningQuantity.push({ date: t.trade_date as string, quantity: qty });
  }

  return {
    avgCost: holding?.avg_cost ?? null,
    markers,
    runningQuantity,
  };
}
