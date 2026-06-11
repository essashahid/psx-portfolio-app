import {
  alphaVantageKey,
  finnhubKey,
  twelveDataKey,
  psxTerminalConfig,
} from "@/lib/providers/env";
import {
  RateLimitError,
  type ProviderQuote,
  type ProviderHistory,
  type ProviderCandle,
} from "@/lib/providers/types";
import { fetchPsxEod } from "@/lib/market-data/psx-dps";

const TIMEOUT_MS = 9000;

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.status === 429) throw new RateLimitError(new URL(url).hostname);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const n = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// ── PSX official portal (dps.psx.com.pk) ───────────────────────────────────
// Free, no key, best PSX coverage. Quote = latest intraday tick (or EOD),
// prev close from the EOD series.

export async function psxDpsQuote(ticker: string): Promise<ProviderQuote | null> {
  const candles = await fetchPsxEod(ticker);
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  return {
    provider: "psx-dps",
    providerSymbol: ticker.toUpperCase(),
    price: last.close,
    prevClose: prev?.close ?? null,
    open: null,
    high: null,
    low: null,
    volume: last.volume || null,
    asOf: last.date,
    asOfTime: null,
    isRealtime: last.date === today(),
  };
}

export async function psxDpsHistory(ticker: string): Promise<ProviderHistory | null> {
  const candles = await fetchPsxEod(ticker);
  if (candles.length === 0) return null;
  return {
    provider: "psx-dps",
    providerSymbol: ticker.toUpperCase(),
    candles: candles.map((c) => ({ date: c.date, open: null, high: null, low: null, close: c.close, volume: c.volume })),
  };
}

// ── PSX Terminal (optional community API) ──────────────────────────────────
// Endpoint shape per psxterminal.com docs: /api/ticks/REG/{SYMBOL} returns
// { success, data: { price, change, changePercent, volume, timestamp, ... } }.
// Defensive parsing: field names are probed so minor API drift doesn't break us.

export async function psxTerminalQuote(ticker: string): Promise<ProviderQuote | null> {
  const cfg = psxTerminalConfig();
  if (!cfg.enabled) return null;
  const sym = ticker.toUpperCase();
  const headers: Record<string, string> = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};

  const json = (await getJson(`${cfg.baseUrl}/api/ticks/REG/${encodeURIComponent(sym)}`, headers)) as {
    success?: boolean;
    data?: Record<string, unknown>;
  };
  const d = json?.data;
  if (!d || json.success === false) return null;
  const price = n(d.price) ?? n(d.close) ?? n(d.last);
  if (price === null || price <= 0) return null;

  const ts = n(d.timestamp);
  const change = n(d.change);
  return {
    provider: "psx-terminal",
    providerSymbol: sym,
    price,
    prevClose: change !== null ? price - change : n(d.previousClose),
    open: n(d.open),
    high: n(d.high),
    low: n(d.low),
    volume: n(d.volume),
    asOf: ts ? new Date(ts > 1e12 ? ts : ts * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }) : today(),
    asOfTime: ts ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString() : null,
    isRealtime: true,
  };
}

// ── Twelve Data ─────────────────────────────────────────────────────────────

export async function twelveDataQuote(ticker: string): Promise<ProviderQuote | null> {
  const key = twelveDataKey();
  if (!key) return null;
  const url = new URL("https://api.twelvedata.com/quote");
  url.searchParams.set("symbol", ticker.toUpperCase());
  url.searchParams.set("exchange", "XKAR");
  url.searchParams.set("apikey", key);

  const d = (await getJson(url.toString())) as Record<string, unknown>;
  if (d.status === "error") {
    if (Number(d.code) === 429) throw new RateLimitError("twelve-data");
    return null;
  }
  const price = n(d.close);
  if (price === null || price <= 0) return null;
  return {
    provider: "twelve-data",
    providerSymbol: `${ticker.toUpperCase()}:XKAR`,
    price,
    prevClose: n(d.previous_close),
    open: n(d.open),
    high: n(d.high),
    low: n(d.low),
    volume: n(d.volume),
    asOf: String(d.datetime ?? "").slice(0, 10) || today(),
    asOfTime: null,
    isRealtime: false,
  };
}

export async function twelveDataHistory(ticker: string): Promise<ProviderHistory | null> {
  const key = twelveDataKey();
  if (!key) return null;
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", ticker.toUpperCase());
  url.searchParams.set("exchange", "XKAR");
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "1300");
  url.searchParams.set("apikey", key);

  const d = (await getJson(url.toString())) as {
    status?: string;
    code?: number;
    values?: Record<string, unknown>[];
  };
  if (d.status === "error") {
    if (Number(d.code) === 429) throw new RateLimitError("twelve-data");
    return null;
  }
  const candles: ProviderCandle[] = (d.values ?? [])
    .map((v) => ({
      date: String(v.datetime ?? "").slice(0, 10),
      open: n(v.open),
      high: n(v.high),
      low: n(v.low),
      close: n(v.close) ?? 0,
      volume: n(v.volume) ?? 0,
    }))
    .filter((c) => c.date && c.close > 0)
    .reverse();
  if (candles.length === 0) return null;
  return { provider: "twelve-data", providerSymbol: `${ticker.toUpperCase()}:XKAR`, candles };
}

// ── Finnhub ─────────────────────────────────────────────────────────────────

export async function finnhubQuote(ticker: string, symbol: string): Promise<ProviderQuote | null> {
  const key = finnhubKey();
  if (!key) return null;
  const url = new URL("https://finnhub.io/api/v1/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", key);

  const d = (await getJson(url.toString())) as { c?: number; pc?: number; o?: number; h?: number; l?: number; t?: number };
  const price = n(d.c);
  if (price === null || price <= 0) return null; // Finnhub returns c=0 for unknown symbols
  return {
    provider: "finnhub",
    providerSymbol: symbol,
    price,
    prevClose: n(d.pc),
    open: n(d.o),
    high: n(d.h),
    low: n(d.l),
    volume: null,
    asOf: d.t ? new Date(d.t * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }) : today(),
    asOfTime: d.t ? new Date(d.t * 1000).toISOString() : null,
    isRealtime: false,
  };
}

// ── Alpha Vantage ───────────────────────────────────────────────────────────

export async function alphaVantageQuote(ticker: string, symbol: string): Promise<ProviderQuote | null> {
  const key = alphaVantageKey();
  if (!key) return null;
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "GLOBAL_QUOTE");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", key);

  const json = (await getJson(url.toString())) as Record<string, unknown>;
  if (typeof json.Note === "string" || typeof json.Information === "string") {
    throw new RateLimitError("alpha-vantage");
  }
  const q = json["Global Quote"] as Record<string, unknown> | undefined;
  const price = n(q?.["05. price"]);
  if (!q || price === null || price <= 0) return null;
  return {
    provider: "alpha-vantage",
    providerSymbol: symbol,
    price,
    prevClose: n(q["08. previous close"]),
    open: n(q["02. open"]),
    high: n(q["03. high"]),
    low: n(q["04. low"]),
    volume: n(q["06. volume"]),
    asOf: String(q["07. latest trading day"] ?? "").slice(0, 10) || today(),
    asOfTime: null,
    isRealtime: false,
  };
}

export async function alphaVantageHistory(ticker: string, symbol: string): Promise<ProviderHistory | null> {
  const key = alphaVantageKey();
  if (!key) return null;
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("outputsize", "full");
  url.searchParams.set("apikey", key);

  const json = (await getJson(url.toString())) as Record<string, unknown>;
  if (typeof json.Note === "string" || typeof json.Information === "string") {
    throw new RateLimitError("alpha-vantage");
  }
  const series = json["Time Series (Daily)"] as Record<string, Record<string, unknown>> | undefined;
  if (!series) return null;
  const candles: ProviderCandle[] = Object.entries(series)
    .map(([date, v]) => ({
      date,
      open: n(v["1. open"]),
      high: n(v["2. high"]),
      low: n(v["3. low"]),
      close: n(v["4. close"]) ?? 0,
      volume: n(v["5. volume"]) ?? 0,
    }))
    .filter((c) => c.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (candles.length === 0) return null;
  return { provider: "alpha-vantage", providerSymbol: symbol, candles };
}
