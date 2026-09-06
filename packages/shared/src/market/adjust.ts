/**
 * Back-adjust a daily price series for bonus and split events.
 *
 * PSX price history is stored exactly as the exchange printed it, with no
 * correction for corporate actions. A bonus issue or a split therefore lands
 * as a single enormous session: Mari reads 3,536.83 on 13 September 2024 and
 * 415.90 on 16 September 2024, an apparent 88% collapse that never happened.
 * Drawn unadjusted, a chart shows a crash and every multi-session statistic
 * (moving average, 52-week range, RSI) is poisoned by one artefact.
 *
 * The heuristic is deliberately simple. PSX enforces daily price limits on
 * every ordinary share, historically 7.5% of the previous close in either
 * direction and 10% under the 2019 revision, with circuit breakers on top of
 * that. A genuine one-session move of 40% or more cannot happen under those
 * rules, so a close-to-close ratio above 1.4 or below 0.6 can only be a
 * corporate action, a data error, or a resumption after a long suspension.
 * All three are better neutralised than drawn.
 *
 * Adjustment is the standard back-adjustment: every session before the break
 * is scaled by the break ratio, so the most recent close is always the price
 * that actually traded and older prices are restated in today's share terms.
 * Two breaks compound, exactly as two consecutive splits would.
 *
 * This remains a display fix on a data problem. The proper answer is a
 * corporate actions table applied at ingest, and this module should be
 * retired when that exists.
 */

/** A session-on-session ratio at or above this is not a trade. */
export const CORPORATE_ACTION_UP_RATIO = 1.4;
/** A session-on-session ratio at or below this is not a trade. */
export const CORPORATE_ACTION_DOWN_RATIO = 0.6;

export interface CorporateActionBreak {
  /**
   * Index of the first candle after the break. The ratio is
   * candles[index].close / candles[index - 1].close, and every candle before
   * `index` is scaled by it.
   */
  index: number;
  ratio: number;
}

interface CloseLike {
  close: number;
}

function usable(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * The sessions treated as corporate actions, oldest first.
 *
 * Input must be oldest first. Pairs where either close is missing, zero or
 * non-finite are skipped rather than flagged, because a ratio against nothing
 * says nothing.
 */
export function detectCorporateActionBreaks<T extends CloseLike>(candles: T[]): CorporateActionBreak[] {
  const breaks: CorporateActionBreak[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]?.close;
    const cur = candles[i]?.close;
    if (!usable(prev) || !usable(cur)) continue;
    const ratio = cur / prev;
    if (ratio > CORPORATE_ACTION_UP_RATIO || ratio < CORPORATE_ACTION_DOWN_RATIO) {
      breaks.push({ index: i, ratio });
    }
  }
  return breaks;
}

/**
 * A new array with every close before a break scaled into current share
 * terms. `open`, `high` and `low` are scaled alongside when the candle carries
 * them as numbers; `volume` and everything else is copied untouched. The
 * input is not mutated and the latest candle is never changed.
 */
export function adjustForCorporateActions<T extends CloseLike>(candles: T[]): T[] {
  if (candles.length < 2) return candles.slice();
  const breaks = detectCorporateActionBreaks(candles);
  if (breaks.length === 0) return candles.slice();

  // Walk from newest to oldest carrying the cumulative factor. A break at
  // index i applies to every candle strictly before i, so the factor grows
  // after candle i has been emitted.
  const out: T[] = new Array(candles.length);
  let factor = 1;
  let nextBreak = breaks.length - 1;
  for (let i = candles.length - 1; i >= 0; i--) {
    out[i] = factor === 1 ? candles[i] : scaleCandle(candles[i], factor);
    while (nextBreak >= 0 && breaks[nextBreak].index === i) {
      factor *= breaks[nextBreak].ratio;
      nextBreak--;
    }
  }
  return out;
}

function scaleCandle<T extends CloseLike>(candle: T, factor: number): T {
  const scaled = { ...candle } as Record<string, unknown>;
  for (const key of ["open", "high", "low", "close"]) {
    const v = scaled[key];
    if (usable(v)) scaled[key] = v * factor;
  }
  return scaled as T;
}
