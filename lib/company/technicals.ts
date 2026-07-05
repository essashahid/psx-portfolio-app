import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";
import { freshnessFor, isStaleOrMissing, TTL_MINUTES } from "@/lib/company/freshness";
import type { Candle, Quote, Technicals, TechnicalFlag } from "@/lib/company/types";
import { computeSignals } from "@/lib/market/technicals";

const MAX_STORED_CANDLES = 1300; // ~5 trading years, enough for every chart range

function hasServiceRole(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// --- Indicator math (pure) -------------------------------------------------

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Wilder's RSI over `period` (default 14). */
function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Annualized volatility (%) from daily log-ish returns over the last `window`. */
function volatility(closes: number[], window = 30): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function pct(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

/**
 * Compact sparkline series for the screener: the last ~quarter of closes
 * downsampled to at most `points` values. Small enough to read across the whole
 * universe in one query, detailed enough to show the recent trend shape.
 */
export function sparkline(candles: Candle[], lookback = 90, points = 40): number[] {
  const closes = candles.slice(-lookback).map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0);
  if (closes.length <= points) return closes;
  const step = (closes.length - 1) / (points - 1);
  const out: number[] = [];
  for (let i = 0; i < points; i++) out.push(closes[Math.round(i * step)]);
  return out;
}

export function computeTechnicals(ticker: string, candles: Candle[]): Omit<Technicals, "meta"> {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // 52-week window = last ~252 trading days.
  const yearSlice = candles.slice(-252);
  const yearCloses = yearSlice.map((c) => c.close);
  const high52 = yearCloses.length ? Math.max(...yearCloses) : null;
  const low52 = yearCloses.length ? Math.min(...yearCloses) : null;

  const latest = last?.close ?? null;
  const prevClose = prev?.close ?? null;
  const dayChangePct = latest !== null && prevClose ? pct(prevClose, latest) : null;

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma100 = sma(closes, 100);
  const ma200 = sma(closes, 200);
  const avgVol = volumes.length >= 30 ? sma(volumes, 30) : volumes.length ? sma(volumes, volumes.length) : null;
  const rsiVal = rsi(closes);

  const distHigh = latest !== null && high52 ? pct(high52, latest) : null;
  const distLow = latest !== null && low52 ? pct(low52, latest) : null;

  const flags = buildFlags({ latest, ma50, ma200, rsiVal, high52, low52, volume: last?.volume ?? null, avgVol });

  return {
    ticker,
    asOfDate: last?.date ?? null,
    latestPrice: latest,
    prevClose,
    dayChangePct,
    volume: last?.volume ?? null,
    averageVolume: avgVol,
    ma20,
    ma50,
    ma100,
    ma200,
    rsi: rsiVal,
    fiftyTwoWeekHigh: high52,
    fiftyTwoWeekLow: low52,
    distanceFromHighPct: distHigh,
    distanceFromLowPct: distLow,
    volatility: volatility(closes),
    flags,
    history: candles.slice(-MAX_STORED_CANDLES),
  };
}

function buildFlags(x: {
  latest: number | null;
  ma50: number | null;
  ma200: number | null;
  rsiVal: number | null;
  high52: number | null;
  low52: number | null;
  volume: number | null;
  avgVol: number | null;
}): TechnicalFlag[] {
  const flags: TechnicalFlag[] = [];
  if (x.latest !== null && x.ma50 !== null) {
    flags.push(
      x.latest >= x.ma50
        ? { label: "Price above 50-day MA", tone: "positive" }
        : { label: "Price below 50-day MA", tone: "negative" }
    );
  }
  if (x.latest !== null && x.ma200 !== null) {
    flags.push(
      x.latest >= x.ma200
        ? { label: "Price above 200-day MA", tone: "positive" }
        : { label: "Price below 200-day MA", tone: "negative" }
    );
  }
  if (x.rsiVal !== null) {
    if (x.rsiVal >= 70) flags.push({ label: `RSI elevated (${x.rsiVal.toFixed(0)})`, tone: "neutral" });
    else if (x.rsiVal <= 30) flags.push({ label: `RSI depressed (${x.rsiVal.toFixed(0)})`, tone: "neutral" });
    else flags.push({ label: `RSI neutral (${x.rsiVal.toFixed(0)})`, tone: "neutral" });
  }
  if (x.latest !== null && x.high52 && x.latest >= x.high52 * 0.97) {
    flags.push({ label: "Near 52-week high", tone: "neutral" });
  }
  if (x.latest !== null && x.low52 && x.latest <= x.low52 * 1.03) {
    flags.push({ label: "Near 52-week low", tone: "neutral" });
  }
  if (x.volume !== null && x.avgVol && x.volume >= x.avgVol * 1.5) {
    flags.push({ label: "Volume above recent average", tone: "neutral" });
  }
  return flags;
}

// --- Cache-first service ---------------------------------------------------

interface TechRow {
  ticker: string;
  data: { history?: Candle[] } | null;
  last_fetched_at: string | null;
  updated_at: string | null;
  source: string | null;
}

export async function getTechnicals(supabase: SupabaseClient, ticker: string): Promise<Technicals> {
  const t = ticker.toUpperCase();
  const { data: cached } = await supabase
    .from("company_technicals")
    .select("ticker, data, last_fetched_at, updated_at, source")
    .eq("ticker", t)
    .maybeSingle();

  const freshness = freshnessFor((cached as TechRow | null)?.last_fetched_at ?? null, TTL_MINUTES.technicals);
  const cachedHistory = (cached as TechRow | null)?.data?.history ?? null;

  if (cached && cachedHistory?.length && !isStaleOrMissing(freshness)) {
    return finalize(computeTechnicals(t, cachedHistory), (cached as TechRow).source, (cached as TechRow).updated_at, "fresh");
  }

  // Cache miss or stale — recompute from the PSX portal. Falls back to any
  // cached history if the live fetch fails so the section never goes blank.
  try {
    const candles = await fetchPsxEod(t);
    if (candles.length > 0) {
      const computed = computeTechnicals(t, candles);
      await cacheTechnicals(t, computed);
      return finalize(computed, "psx-dps", new Date().toISOString(), "fresh");
    }
  } catch {
    /* fall through */
  }

  if (cachedHistory?.length) {
    return finalize(computeTechnicals(t, cachedHistory), (cached as TechRow)?.source ?? "psx-dps", (cached as TechRow)?.updated_at ?? null, "stale");
  }

  return emptyTechnicals(t);
}

/** Forces a recompute from PSX (used by the section refresh route). */
export async function refreshTechnicals(ticker: string): Promise<Technicals> {
  const t = ticker.toUpperCase();
  const candles = await fetchPsxEod(t);
  if (candles.length === 0) return emptyTechnicals(t);
  const computed = computeTechnicals(t, candles);
  await cacheTechnicals(t, computed);
  return finalize(computed, "psx-dps", new Date().toISOString(), "fresh");
}

function finalize(
  base: Omit<Technicals, "meta">,
  source: string | null,
  lastUpdated: string | null,
  freshness: Technicals["meta"]["freshness"]
): Technicals {
  return {
    ...base,
    meta: { source: source ?? "psx-dps", sourceUrl: "https://dps.psx.com.pk", lastUpdated, freshness },
  };
}

function emptyTechnicals(ticker: string): Technicals {
  return {
    ticker,
    asOfDate: null,
    latestPrice: null,
    prevClose: null,
    dayChangePct: null,
    volume: null,
    averageVolume: null,
    ma20: null,
    ma50: null,
    ma100: null,
    ma200: null,
    rsi: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    distanceFromHighPct: null,
    distanceFromLowPct: null,
    volatility: null,
    flags: [],
    history: [],
    meta: { source: null, lastUpdated: null, freshness: "missing" },
  };
}

async function cacheTechnicals(ticker: string, t: Omit<Technicals, "meta">): Promise<void> {
  if (!hasServiceRole()) return;
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    await admin.from("company_technicals").upsert(
      {
        ticker,
        as_of_date: t.asOfDate,
        latest_price: t.latestPrice,
        prev_close: t.prevClose,
        day_change_pct: t.dayChangePct,
        volume: t.volume,
        average_volume: t.averageVolume,
        moving_average_20: t.ma20,
        moving_average_50: t.ma50,
        moving_average_100: t.ma100,
        moving_average_200: t.ma200,
        rsi: t.rsi,
        fifty_two_week_high: t.fiftyTwoWeekHigh,
        fifty_two_week_low: t.fiftyTwoWeekLow,
        volatility: t.volatility,
        spark: sparkline(t.history),
        // Rich indicator bundle (EMA21/55, EFI, Klinger-approx, divergences,
        // Fib/ABCD, seasonality, trade plan) computed from the same close+volume
        // history — surfaced to the chat LLM so it reads structure, not just MA/RSI.
        data: { history: t.history, flags: t.flags, signals: computeSignals(t.history) },
        source: "psx-dps",
        last_fetched_at: now,
        updated_at: now,
      },
      { onConflict: "ticker" }
    );
    // Durable copy of recent candles for other consumers.
    const recent = t.history.slice(-260);
    if (recent.length) {
      await admin.from("company_price_history").upsert(
        recent.map((c) => ({ ticker, price_date: c.date, close: c.close, volume: c.volume, source: "psx-dps", updated_at: now })),
        { onConflict: "ticker,price_date" }
      );
    }
  } catch {
    /* best-effort cache write */
  }
}

/** Lightweight quote derived from the technicals snapshot (fast path for the header). */
export function quoteFromTechnicals(t: Technicals): Quote {
  return {
    ticker: t.ticker,
    price: t.latestPrice,
    prevClose: t.prevClose,
    dayChange: t.latestPrice !== null && t.prevClose !== null ? t.latestPrice - t.prevClose : null,
    dayChangePct: t.dayChangePct,
    volume: t.volume,
    asOf: t.asOfDate,
    meta: t.meta,
  };
}
