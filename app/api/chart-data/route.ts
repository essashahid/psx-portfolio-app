/**
 * Price history endpoint for the Research Copilot's inline chart artifacts.
 * GET /api/chart-data?ticker=FCCL&period=1Y
 *
 * Returns daily OHLCV candles trimmed to the requested period, plus the user's
 * average cost and user transaction markers for the ticker (when available) so
 * the chart can draw overlays without embedding sensitive data in the model's
 * output.
 */
import { requireUser } from "@/lib/api-helpers";
import { getDailyCandles } from "@/lib/chat/data";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";
import type { Candle } from "@/lib/market/technicals";

export const dynamic = "force-dynamic";

type ChartCandle = Candle & {
  open?: number | null;
  high?: number | null;
  low?: number | null;
};

const PERIOD_DAYS: Record<string, number> = {
  "1M": 31,
  "3M": 92,
  "6M": 183,
  "1Y": 365,
  "2Y": 730,
  "3Y": 1095,
  "5Y": 1825,
};

export async function GET(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const url = new URL(request.url);
  const ticker = (url.searchParams.get("ticker") ?? "").toUpperCase().trim();
  const period = url.searchParams.get("period") ?? "1Y";

  if (!ticker) {
    return Response.json({ error: "ticker is required" }, { status: 400 });
  }

  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS["1Y"];
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  // Fetch candles — cached technicals first, live PSX as fallback.
  let candles: ChartCandle[] = await getDailyCandles(supabase, ticker);
  if (candles.length === 0) {
    candles = await fetchPsxEod(ticker);
  }

  const trimmed = candles
    .filter((c) => c.date >= cutoff && Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((c) => ({
      date: c.date,
      close: c.close,
      open: c.open ?? null,
      high: c.high ?? null,
      low: c.low ?? null,
      volume: c.volume ?? null,
    }));

  // User's cost basis for this ticker (null when not held).
  let avgCost: number | null = null;
  const { data: holding } = await supabase
    .from("holdings")
    .select("avg_cost")
    .eq("user_id", user.id)
    .eq("ticker", ticker)
    .eq("hidden", false)
    .gt("quantity", 0)
    .maybeSingle();
  if (holding?.avg_cost) avgCost = Number(holding.avg_cost);

  // Recent dividends for the ticker so the chart can mark ex-dividend dates.
  const { data: divRows } = await supabase
    .from("dividends")
    .select("ex_date, amount")
    .eq("ticker", ticker)
    .gte("ex_date", cutoff)
    .order("ex_date", { ascending: true });

  const dividends = (divRows ?? [])
    .filter((d) => d.ex_date)
    .map((d) => ({ date: d.ex_date as string, amount: Number(d.amount) }));

  // User transaction dates for optional buy/sell/corporate-action markers.
  const { data: txnRows } = await supabase
    .from("transactions")
    .select("trade_date, type, quantity, price")
    .eq("user_id", user.id)
    .eq("ticker", ticker)
    .gte("trade_date", cutoff)
    .in("type", ["BUY", "SELL", "RIGHT", "BONUS", "SPLIT", "ADJUST"])
    .order("trade_date", { ascending: true });

  const transactions = (txnRows ?? [])
    .filter((t) => t.trade_date)
    .map((t) => ({
      date: t.trade_date as string,
      type: String(t.type ?? "UNKNOWN"),
      quantity: t.quantity != null ? Number(t.quantity) : null,
      price: t.price != null ? Number(t.price) : null,
    }));

  return Response.json({
    ticker,
    period,
    candles: trimmed,
    avgCost,
    dividends,
    transactions,
  });
}
