import type { CompanyPayout, CompanyRatio, KeyFigure, TrendPoint } from "@psx/shared/api/stocks";
import { formatNumber } from "@psx/shared/format";

/**
 * One plain sentence under each question on the company Overview.
 *
 * Every reading is derived on the phone from fields the company route already
 * sends: the filed-year trend points, the declared payouts, the key figures and
 * the ratio card. No new number is invented here; each sentence restates a
 * figure the screen also shows, so the words and the digits cannot disagree.
 */

/**
 * "Revenue grew about 12% a year since FY2021." The compound rate from the
 * first filed year to the last. Two points is the minimum for a rate, and a
 * sign change (a loss year at either end) has no meaningful rate, so those
 * cases say so rather than printing a number.
 */
export function growthReading(points: TrendPoint[], what = "Revenue"): string {
  const sorted = [...points].sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return "Not enough filed years to judge.";
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const years = last.year - first.year;
  if (years <= 0) return "Not enough filed years to judge.";
  if (first.value <= 0 || last.value <= 0) {
    return `${what} moved between profit and loss over these years, so a yearly rate would mislead.`;
  }
  const rate = (Math.pow(last.value / first.value, 1 / years) - 1) * 100;
  const size = formatNumber(Math.abs(rate), Math.abs(rate) < 1 ? 1 : 0);
  if (Math.abs(rate) < 0.5) return `${what} was about flat since FY${first.year}.`;
  return `${what} ${rate >= 0 ? "grew" : "fell"} about ${size}% a year since FY${first.year}.`;
}

function withinLastYear(date: string | null, now: Date): boolean {
  if (!date) return false;
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  return d >= yearAgo && d <= now;
}

/**
 * "Paid PKR 12.00 per share over the last year, about 45% of earnings."
 *
 * Per-share cash comes from the declared payout ledger dated in the last
 * twelve months. When the ledger has no dated cash payout but the yield figure
 * is present, the yield times the price gives the same number by another road.
 * The share of earnings is the payout ratio from the ratio card.
 */
export function payoutReading({
  payouts,
  yieldFigure,
  ratios,
  price,
  now = new Date(),
}: {
  payouts: CompanyPayout[];
  yieldFigure: KeyFigure | null;
  ratios: CompanyRatio[];
  price: number | null | undefined;
  now?: Date;
}): string {
  const cash = payouts.filter((p) => (!p.kind || p.kind.toLowerCase() === "cash") && p.dps !== null);
  const recent = cash.filter((p) => withinLastYear(p.date, now));
  let perShare: number | null = null;
  if (recent.length > 0) {
    perShare = recent.reduce((sum, p) => sum + (p.dps ?? 0), 0);
  } else if (yieldFigure?.value != null && price != null && price > 0) {
    perShare = (yieldFigure.value / 100) * price;
  }

  if (perShare === null || perShare <= 0) {
    if (cash.length > 0) return "No cash payout declared in the last year.";
    return "No cash payouts on record.";
  }

  const payoutRow = ratios.find((r) => r.name === "Payout ratio");
  const payoutPct = typeof payoutRow?.value === "number" && Number.isFinite(payoutRow.value) ? payoutRow.value : null;
  const base = `Paid PKR ${formatNumber(perShare, 2)} per share over the last year`;
  if (payoutPct === null) return `${base}.`;
  if (payoutPct > 100) return `${base}, more than it earned.`;
  return `${base}, about ${formatNumber(payoutPct, 0)}% of earnings.`;
}

/**
 * "Priced at 8.4x earnings." When the multiple is withheld, the reason the
 * server gave is the sentence, so a reader is never shown a dash without a why.
 */
export function valuationReading(peFigure: KeyFigure | null): string {
  if (!peFigure) return "No earnings multiple published for this company yet.";
  if (peFigure.value === null) {
    return peFigure.withheld ?? "No earnings multiple published for this company yet.";
  }
  return `Priced at ${formatNumber(peFigure.value, 1)}x earnings.`;
}

/**
 * A key figure hidden from the Overview list. A gap in the filings ("Not
 * calculated") tells the reader nothing about the company, so it goes. A
 * contested figure or a loss-making period is information and stays.
 */
export function isGapFigure(figure: KeyFigure): boolean {
  return figure.value === null && (figure.withheld ?? "").startsWith("Not calculated");
}

const SMALL_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** "eight" for 8, "12" past ten. */
export function countWord(n: number): string {
  return SMALL_WORDS[n] ?? String(n);
}
