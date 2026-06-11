import type { ProviderName } from "@/lib/providers/env";

/** Normalized quote any adapter must return. Null fields = provider doesn't supply them. */
export interface ProviderQuote {
  provider: ProviderName;
  providerSymbol: string;
  price: number;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  asOf: string;            // YYYY-MM-DD
  asOfTime: string | null; // ISO, when intraday
  isRealtime: boolean;
}

export interface ProviderCandle {
  date: string; // YYYY-MM-DD
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
}

export interface ProviderHistory {
  provider: ProviderName;
  providerSymbol: string;
  candles: ProviderCandle[]; // oldest first
}

/** Thrown by adapters when the provider answered but signalled throttling. */
export class RateLimitError extends Error {
  constructor(provider: string) {
    super(`${provider} rate limit reached`);
    this.name = "RateLimitError";
  }
}

/** Candidate symbol spellings to try on a given provider for a PSX ticker. */
export function symbolVariants(ticker: string, provider: ProviderName): string[] {
  const t = ticker.toUpperCase();
  switch (provider) {
    case "twelve-data":
      return [t]; // exchange passed separately as XKAR
    case "finnhub":
      return [`${t}.KAR`, t, `PSX:${t}`];
    case "alpha-vantage":
      return [`${t}.KAR`, `${t}.PSX`, t];
    default:
      return [t];
  }
}
