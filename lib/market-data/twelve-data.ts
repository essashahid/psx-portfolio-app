import type { MarketDataProvider, PricePoint } from "@/lib/market-data/adapter";

const BASE_URL = "https://api.twelvedata.com";
const EXCHANGE = "XKAR";
const SOURCE = "twelve-data";

type TwelveDataEodResponse =
  | {
      symbol?: string;
      exchange?: string;
      datetime?: string;
      close?: string;
      status?: undefined;
    }
  | {
      status: "error";
      code?: number;
      message?: string;
    };

type TwelveDataSeriesResponse =
  | {
      meta?: { symbol?: string; exchange?: string };
      values?: { datetime?: string; close?: string }[];
      status?: undefined;
    }
  | {
      status: "error";
      code?: number;
      message?: string;
    };

export function twelveDataConfigured(): boolean {
  return !!(process.env.TWELVE_DATA_API_KEY || process.env.MARKET_DATA_API_KEY);
}

function apiKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY || process.env.MARKET_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY is not configured.");
  return key;
}

export class TwelveDataProvider implements MarketDataProvider {
  readonly name = SOURCE;

  async getLatestPrice(ticker: string): Promise<PricePoint | null> {
    const url = new URL("/eod", BASE_URL);
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("exchange", EXCHANGE);
    url.searchParams.set("apikey", apiKey());

    const data = (await fetchJson(url)) as TwelveDataEodResponse;
    if ("status" in data && data.status === "error") return null;

    const price = Number(data.close);
    if (!Number.isFinite(price) || price <= 0 || !data.datetime) return null;
    return { ticker, price, date: data.datetime.slice(0, 10), source: SOURCE };
  }

  async getHistoricalPrices(ticker: string, startDate: string, endDate: string): Promise<PricePoint[]> {
    const url = new URL("/time_series", BASE_URL);
    url.searchParams.set("symbol", ticker);
    url.searchParams.set("exchange", EXCHANGE);
    url.searchParams.set("interval", "1day");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("outputsize", "5000");
    url.searchParams.set("apikey", apiKey());

    const data = (await fetchJson(url)) as TwelveDataSeriesResponse;
    if ("status" in data && data.status === "error") return [];

    return (data.values ?? [])
      .map((row) => {
        const price = Number(row.close);
        if (!row.datetime || !Number.isFinite(price) || price <= 0) return null;
        return { ticker, price, date: row.datetime.slice(0, 10), source: SOURCE };
      })
      .filter((p): p is PricePoint => !!p)
      .reverse();
  }
}

async function fetchJson(url: URL): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twelve Data failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}
