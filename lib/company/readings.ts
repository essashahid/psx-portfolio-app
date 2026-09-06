/**
 * The one-sentence readings on the company Overview and Financials tabs.
 *
 * Each of the three plain questions (is it growing, does it pay, is it
 * expensive) gets a single sentence computed from the filed figures, and the
 * price-structure fold gets one describing where the price sits. They are
 * pure functions of numbers so the phone can call the same sentence through
 * the API and the two surfaces cannot drift. Every branch that lacks the data
 * says so in words rather than returning nothing.
 */

export interface YearPoint {
  year: number;
  value: number;
}

const rate = (points: YearPoint[]): number | null => {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const years = last.year - first.year;
  if (years <= 0 || first.value <= 0 || last.value <= 0) return null;
  return (Math.pow(last.value / first.value, 1 / years) - 1) * 100;
};

const pace = (r: number): string => (Math.abs(r) < 1 ? "was flat" : `${r > 0 ? "grew" : "fell"} about ${Math.abs(r).toFixed(0)}% a year`);

/**
 * "Revenue grew about 6% a year since FY2022 and profit kept pace."
 *
 * Revenue leads because it is the least manipulable line; earnings per share
 * is read against it. A latest-year loss is named rather than folded into a
 * rate that cannot be computed across a sign change.
 */
export function growthReading(revenue: YearPoint[], eps: YearPoint[]): string {
  const revRate = rate(revenue);
  const epsRate = rate(eps);
  const lastEps = eps[eps.length - 1] ?? null;
  const since = (points: YearPoint[]) => `since FY${points[0].year}`;

  if (revRate === null && epsRate === null) {
    if (lastEps && lastEps.value < 0) return `The latest filed year, FY${lastEps.year}, was a loss. Not enough filed years to read a trend.`;
    return "Not enough filed years to read a trend.";
  }

  if (revRate === null) {
    return `Earnings per share ${pace(epsRate as number)} ${since(eps)}. Revenue has too few filed years to compare.`;
  }

  const head = `Revenue ${pace(revRate)} ${since(revenue)}`;
  if (lastEps && lastEps.value < 0) return `${head}, but FY${lastEps.year} was a loss.`;
  if (epsRate === null) return `${head}. Earnings per share has too few filed years to compare.`;

  const gap = epsRate - revRate;
  if (Math.abs(gap) <= 3) return `${head} and profit kept pace.`;
  if (gap > 0) return `${head} and profit grew faster, about ${Math.abs(epsRate).toFixed(0)}% a year.`;
  if (epsRate < -1) return `${head} while earnings per share fell about ${Math.abs(epsRate).toFixed(0)}% a year.`;
  return `${head} while profit lagged, about ${Math.abs(epsRate).toFixed(0)}% a year.`;
}

/**
 * "Paid PKR 16.00 per share over the last year, a 5.2% yield at today's
 * price, about 60% of earnings."
 */
export function payoutReading(input: { ttmDps: number | null; divYield: number | null; payoutRatio: number | null }): string {
  const { ttmDps, divYield, payoutRatio } = input;
  if (ttmDps === null || divYield === null) return "No verified cash dividend in the last 12 months.";
  const base = `Paid PKR ${ttmDps.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per share over the last year, a ${divYield.toFixed(2)}% yield at today's price`;
  if (payoutRatio === null || !Number.isFinite(payoutRatio) || payoutRatio <= 0) return `${base}.`;
  return `${base}, about ${payoutRatio.toFixed(0)}% of earnings.`;
}

/**
 * "Priced at 12.0x earnings, below the sector's 15.0x."
 *
 * A withheld multiple is explained by its cause: a loss, a contested filing,
 * or plain missing data. The reason text comes from the engine's `missing`.
 */
export function valuationReading(input: {
  pe: number | null;
  sectorMedianPe: number | null;
  peers: number;
  missing?: string | null;
}): string {
  const { pe, sectorMedianPe, peers, missing } = input;
  if (pe === null || !Number.isFinite(pe)) {
    if (missing && /^Loss-making/i.test(missing)) return "No earnings multiple. The latest period was a loss.";
    if (missing && /^Contested/i.test(missing)) return "Earnings multiple withheld while the filing is under review.";
    return "Not enough filed data to price it on earnings.";
  }
  const head = `Priced at ${pe.toFixed(1)}x earnings`;
  if (sectorMedianPe === null) {
    return `${head}. Only ${peers} peer${peers === 1 ? "" : "s"} priced, so there is no sector median to set it against.`;
  }
  const median = `${sectorMedianPe.toFixed(1)}x`;
  if (pe > sectorMedianPe * 1.1) return `${head}, above the sector's ${median}.`;
  if (pe < sectorMedianPe * 0.9) return `${head}, below the sector's ${median}.`;
  return `${head}, in line with the sector's ${median}.`;
}

/**
 * "Trading above its 50-session average, 18% below the 52-week high."
 *
 * Describes where the price has been, not where it is going. The 50-session
 * average is the one reference, and the distance from the 52-week high says
 * how far a recovery would have to run.
 */
export function priceStructureReading(input: {
  price: number | null;
  ma50: number | null;
  high52: number | null;
  low52: number | null;
}): string {
  const { price, ma50, high52, low52 } = input;
  if (price === null || !Number.isFinite(price)) return "No recent price on file, so there is no price structure to read.";

  const parts: string[] = [];
  if (ma50 !== null && ma50 > 0) {
    const diff = ((price - ma50) / ma50) * 100;
    parts.push(Math.abs(diff) < 0.5 ? "Trading at its 50-session average" : `Trading ${diff > 0 ? "above" : "below"} its 50-session average`);
  }
  if (high52 !== null && high52 > 0 && low52 !== null && high52 > low52) {
    const belowHigh = ((high52 - price) / high52) * 100;
    if (belowHigh < 1) parts.push("at its 52-week high");
    else if (price <= low52 * 1.01) parts.push("at its 52-week low");
    else parts.push(`${belowHigh.toFixed(0)}% below the 52-week high`);
  }
  if (parts.length === 0) return "Not enough price history to read the structure yet.";
  const [first, ...rest] = parts;
  const lead = first.startsWith("at ") ? `Trading ${first}` : first;
  return `${[lead, ...rest].join(", ")}.`;
}
