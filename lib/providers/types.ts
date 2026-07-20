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
    // Exchange-qualified symbols only. These are global providers with little
    // or no PSX coverage, and a BARE ticker silently resolves to whatever
    // same-named listing they do carry — almost always a US one. That is how
    // PPL came back at 35.85 (PPL Corp, a US utility) instead of ~252, COST at
    // 940 (Costco) and HUBC at 1.20, corrupting every price-derived ratio for
    // those names while the financials stayed correct. A missing price is
    // recoverable; a confident wrong one is not.
    case "finnhub":
      return [`${t}.KAR`, `PSX:${t}`];
    case "alpha-vantage":
      return [`${t}.KAR`, `${t}.PSX`];
    default:
      return [t];
  }
}
