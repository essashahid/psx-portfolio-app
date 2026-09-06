import { detectCorporateActionBreaks } from "@psx/shared/market/adjust";
import type { WhatIfResponse } from "@psx/shared/api/what-if";

/**
 * "What if I had invested" arithmetic. Pure, so it is tested on fixed series.
 *
 * Shares are bought at the first close on or after the chosen date. A bonus
 * or split shows in the raw history as a single-session collapse; each one
 * multiplies the share count by the inverse of that ratio, so the position is
 * carried in today's share terms and valued at today's raw price. Each cash
 * dividend pays on the shares held at its book-closure date. Dividends are
 * gross; withholding depends on the person's filer status.
 *
 * Nothing is estimated: a start before the payout record simply reports that
 * dividends are incomplete rather than guessing at them.
 */
export interface WhatIfCandle {
  date: string;
  close: number;
}

export interface WhatIfPayout {
  /** The date the shares had to be held on, or the announcement date when unknown. */
  date: string;
  dps: number;
}

export interface WhatIfInput {
  ticker: string;
  amount: number;
  from: string;
  candles: WhatIfCandle[];
  payouts: WhatIfPayout[];
  /** Earliest payout record on file, whether or not it falls in the window. */
  payoutsKnownFrom: string | null;
  benchmark?: { label: string; candles: WhatIfCandle[] } | null;
}

function firstOnOrAfter(candles: WhatIfCandle[], date: string): number {
  for (let i = 0; i < candles.length; i++) if (candles[i].date >= date) return i;
  return -1;
}

function yearsBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeWhatIf(input: WhatIfInput): WhatIfResponse | { error: string } {
  const candles = input.candles.filter((c) => Number.isFinite(c.close) && c.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (candles.length < 2) return { error: "Not enough price history for this company." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: "Enter an amount above zero." };

  const startIdx = firstOnOrAfter(candles, input.from);
  if (startIdx < 0 || startIdx >= candles.length - 1) return { error: "Pick a date before the latest close." };
  const start = candles[startIdx];
  const end = candles[candles.length - 1];

  // Share count through every bonus or split after the start.
  const breaks = detectCorporateActionBreaks(candles).filter((b) => b.index > startIdx);
  const sharesAtStart = input.amount / start.close;
  const sharesOn = (date: string): number => {
    let shares = sharesAtStart;
    for (const b of breaks) if (candles[b.index].date <= date) shares /= b.ratio;
    return shares;
  };
  const sharesNow = sharesOn(end.date);

  let dividends = 0;
  let dividendCount = 0;
  for (const p of input.payouts) {
    if (!(p.dps > 0) || p.date <= start.date || p.date > end.date) continue;
    dividends += p.dps * sharesOn(p.date);
    dividendCount++;
  }
  const dividendsIncomplete = input.payoutsKnownFrom === null || input.payoutsKnownFrom > start.date;

  const valueNow = sharesNow * end.close;
  const total = valueNow + dividends;
  const years = yearsBetween(start.date, end.date);
  const totalReturnPct = (total / input.amount - 1) * 100;
  const annualisedPct = years >= 0.5 && total > 0 ? (Math.pow(total / input.amount, 1 / years) - 1) * 100 : null;

  let benchmark: WhatIfResponse["benchmark"] = null;
  if (input.benchmark && input.benchmark.candles.length > 1) {
    const b = input.benchmark.candles.filter((c) => c.close > 0).sort((x, y) => x.date.localeCompare(y.date));
    const bi = firstOnOrAfter(b, start.date);
    const bEnd = [...b].reverse().find((c) => c.date <= end.date);
    if (bi >= 0 && bEnd && bEnd.date > b[bi].date) {
      const bValue = input.amount * (bEnd.close / b[bi].close);
      benchmark = { label: input.benchmark.label, valueNow: round2(bValue), returnPct: round2((bValue / input.amount - 1) * 100) };
    }
  }

  return {
    ticker: input.ticker,
    amount: input.amount,
    startDate: start.date,
    startPrice: start.close,
    endDate: end.date,
    endPrice: end.close,
    sharesAtStart: round2(sharesAtStart),
    sharesNow: round2(sharesNow),
    bonusEvents: breaks.length,
    valueNow: round2(valueNow),
    priceGain: round2(valueNow - input.amount),
    dividends: round2(dividends),
    dividendCount,
    dividendsKnownFrom: input.payoutsKnownFrom,
    dividendsIncomplete,
    total: round2(total),
    totalReturnPct: round2(totalReturnPct),
    annualisedPct: annualisedPct === null ? null : round2(annualisedPct),
    years: round2(years),
    benchmark,
    earliestDate: candles[0].date,
  };
}

/** The ISO date `years` before `today`, for the presets. */
export function dateYearsAgo(years: number, today = new Date()): string {
  const d = new Date(today);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}
