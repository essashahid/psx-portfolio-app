/**
 * The contract for GET /api/stocks/[ticker]/what-if?amount=100000&from=2021-09-06
 *
 * "If you had invested this much on this date, what would it be worth now?"
 * Everything is computed on the server from the same history and payout
 * records both surfaces already read, so the web and the phone show one
 * answer.
 */
export interface WhatIfResponse {
  ticker: string;
  amount: number;
  /** The trading day the money is treated as invested on (the first close on or after `from`). */
  startDate: string;
  startPrice: number;
  endDate: string;
  endPrice: number;
  /** Shares bought at the start, and shares held now after any bonus or split. */
  sharesAtStart: number;
  sharesNow: number;
  bonusEvents: number;
  /** Price-only value today. */
  valueNow: number;
  priceGain: number;
  /** Gross cash dividends the shares would have collected, before withholding tax. */
  dividends: number;
  dividendCount: number;
  /** Earliest date the payout record covers; dividends before it are unknown, not zero. */
  dividendsKnownFrom: string | null;
  /** True when the start predates the payout record, so `dividends` is an undercount. */
  dividendsIncomplete: boolean;
  total: number;
  totalReturnPct: number;
  annualisedPct: number | null;
  years: number;
  benchmark: { label: string; valueNow: number; returnPct: number } | null;
  /** The earliest date history allows, so a client can bound its date picker. */
  earliestDate: string;
}

export const WHAT_IF_PRESETS = [
  { key: "1y", label: "1 year", years: 1 },
  { key: "3y", label: "3 years", years: 3 },
  { key: "5y", label: "5 years", years: 5 },
] as const;

export const WHAT_IF_DEFAULT_AMOUNT = 100_000;
