/**
 * Pakistan tax year label (e.g. "2025-26") for a payment date. The tax year
 * runs 1 July to 30 June, so a payment in July 2025 falls in tax year 2025-26.
 */
export function taxYearOf(dateKey: string): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
