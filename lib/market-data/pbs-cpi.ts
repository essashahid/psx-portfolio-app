/**
 * Pakistan Bureau of Statistics — National CPI (General), base 2015-16 = 100.
 *
 * Used for the "inflation-protected capital" benchmark: every rupee contributed
 * is grown by the change in this index, so the line shows what the same money
 * would be worth if it had merely kept pace with consumer prices.
 *
 * Source: PBS Monthly Price Indices (pbs.gov.pk/cpi). National CPI is the
 * default; PBS also publishes separate Urban and Rural series. Values
 * cross-check against Trading Economics (Apr-2026 292.81, May-2026 294.34) and
 * TheGlobalEconomy (Mar-2026 285.73).
 *
 * Keep this list updated as PBS publishes each month. The latest available
 * month is used for any date beyond the table (PBS releases ~1 month in arrears).
 */

export type CpiSeries = "national" | "urban";

/** Month key "YYYY-MM" -> index value. National CPI (General), 2015-16 = 100. */
export const PBS_NATIONAL_CPI: Record<string, number> = {
  "2023-01": 202.53, "2023-02": 211.28, "2023-03": 219.14, "2023-04": 224.41,
  "2023-05": 227.96, "2023-06": 227.37, "2023-07": 235.23, "2023-08": 239.27,
  "2023-09": 244.05, "2023-10": 246.69, "2023-11": 253.15, "2023-12": 255.24,
  "2024-01": 259.92, "2024-02": 260.01, "2024-03": 264.46, "2024-04": 263.32,
  "2024-05": 254.78, "2024-06": 255.94, "2024-07": 261.32, "2024-08": 262.32,
  "2024-09": 260.96, "2024-10": 264.17, "2024-11": 265.46, "2024-12": 265.63,
  "2025-01": 266.17, "2025-02": 263.95, "2025-03": 266.29, "2025-04": 264.06,
  "2025-05": 263.60, "2025-06": 264.22, "2025-07": 271.94, "2025-08": 270.35,
  "2025-09": 276.01, "2025-10": 280.66, "2025-11": 281.78, "2025-12": 280.53,
  "2026-01": 281.62, "2026-02": 282.39, "2026-03": 285.73, "2026-04": 292.81,
  "2026-05": 294.34,
};

const SORTED_KEYS = Object.keys(PBS_NATIONAL_CPI).sort();

/**
 * CPI index for an ISO date (YYYY-MM-DD or YYYY-MM). Falls back to the nearest
 * earlier month, and to the latest available month for dates past the table.
 */
export function cpiForDate(isoDate: string, series: CpiSeries = "national"): number {
  // Only a national series is seeded today; urban falls back to national.
  void series;
  const month = isoDate.slice(0, 7);
  const exact = PBS_NATIONAL_CPI[month];
  if (exact !== undefined) return exact;
  // Nearest earlier month, else the earliest known value.
  let chosen = SORTED_KEYS[0];
  for (const key of SORTED_KEYS) {
    if (key <= month) chosen = key;
    else break;
  }
  return PBS_NATIONAL_CPI[chosen];
}

/** Latest published month key, e.g. "2026-05". */
export function latestCpiMonth(): string {
  return SORTED_KEYS[SORTED_KEYS.length - 1];
}

/** Shift a "YYYY-MM" key by whole months (negative goes back). */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface CpiInflation {
  /** Latest published CPI month, e.g. "2026-05". */
  month: string;
  latestValue: number;
  yearAgoValue: number;
  /** Year-on-year CPI change, in percent. */
  yoyPct: number;
}

/**
 * Year-on-year National CPI inflation from the latest published month (or the
 * latest month at or before `asOf`). Returns null only if the 12-month-prior
 * value is not in the table.
 */
export function cpiYoY(asOf?: string): CpiInflation | null {
  const target = asOf ? asOf.slice(0, 7) : latestCpiMonth();
  // Latest published month at or before the target.
  let month = SORTED_KEYS[0];
  for (const key of SORTED_KEYS) {
    if (key <= target) month = key;
    else break;
  }
  const latestValue = PBS_NATIONAL_CPI[month];
  const yearAgoValue = PBS_NATIONAL_CPI[shiftMonth(month, -12)];
  if (latestValue === undefined || yearAgoValue === undefined || yearAgoValue <= 0) return null;
  return {
    month,
    latestValue,
    yearAgoValue,
    yoyPct: (latestValue / yearAgoValue - 1) * 100,
  };
}
