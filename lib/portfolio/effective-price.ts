/**
 * One rule for "what is this stock worth right now", shared by every surface.
 *
 * Before this, the dashboard valued a holding from the per-user `prices` table
 * (written by a per-user cron that rotated through accounts on a time budget),
 * the company page read `market_quotes`, and the phone patched the first from
 * the market snapshot. Three answers to one question, and they disagreed.
 *
 * The candidates, in the order they are trusted:
 *
 *   1. A user override: a price the user typed in, or one taken from their
 *      broker statement. It wins only when it is at least as new as the
 *      freshest market figure, because a manual price from last month must not
 *      hide this week's close.
 *   2. The shared quote (`market_quotes`), refreshed through the provider chain.
 *   3. The latest close in `company_price_history`, written daily for the whole
 *      universe by the market snapshot.
 *   4. A legacy provider row in the per-user table. Older builds wrote provider
 *      prices there; nothing writes them any more, so this only matters for a
 *      ticker that has no shared price at all.
 *
 * Pure and synchronous so the portfolio and the company page can be tested
 * against the same function with the same inputs, which is the actual promise:
 * same ticker, same user, same price everywhere.
 */

export type PriceSourceKind = "override" | "quote" | "close" | "legacy";

export interface PriceCandidate {
  price: number;
  /** ISO date the price is for (trade date), YYYY-MM-DD. */
  date: string;
  /** The stored source label, for example "manual", "psx-dps". */
  source: string;
}

export interface EffectivePrice extends PriceCandidate {
  kind: PriceSourceKind;
}

export interface PriceCandidates {
  /** Latest row for the user in `prices` regardless of source. */
  userRow?: PriceCandidate | null;
  /** The shared quote row. */
  quote?: PriceCandidate | null;
  /** The latest daily close. */
  close?: PriceCandidate | null;
}

/** Sources in the per-user table that represent the user's own knowledge. */
export const OVERRIDE_SOURCES = new Set(["manual", "statement", "csv", "import"]);

function valid(c: PriceCandidate | null | undefined): c is PriceCandidate {
  return !!c && Number.isFinite(c.price) && c.price > 0 && typeof c.date === "string" && c.date.length >= 10;
}

/**
 * Pick the effective price from the candidates. Returns null only when nothing
 * usable exists, so an unpriced holding stays visibly unpriced rather than
 * being valued at cost by a caller that did not notice.
 */
export function pickEffectivePrice(c: PriceCandidates): EffectivePrice | null {
  const quote = valid(c.quote) ? c.quote : null;
  const close = valid(c.close) ? c.close : null;
  const user = valid(c.userRow) ? c.userRow : null;

  // Freshest market figure: the quote unless the close is strictly newer,
  // which happens when the quote refresh for a ticker fell behind the daily
  // snapshot.
  let market: EffectivePrice | null = null;
  if (quote && close) {
    market = close.date > quote.date ? { ...close, kind: "close" } : { ...quote, kind: "quote" };
  } else if (quote) {
    market = { ...quote, kind: "quote" };
  } else if (close) {
    market = { ...close, kind: "close" };
  }

  if (user && OVERRIDE_SOURCES.has(user.source)) {
    if (!market || user.date >= market.date) return { ...user, kind: "override" };
    return market;
  }
  if (market) return market;
  if (user) return { ...user, kind: "legacy" };
  return null;
}

/** Plain wording for the price's origin, used in "as of" captions. */
export function describePriceSource(kind: PriceSourceKind | null | undefined): string {
  switch (kind) {
    case "override":
      return "your own price";
    case "quote":
      return "delayed market quote";
    case "close":
      return "last close";
    case "legacy":
      return "older stored price";
    default:
      return "no price";
  }
}
