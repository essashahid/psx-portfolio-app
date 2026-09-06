import type { RatioRow } from "@/lib/engine/ratios";
import type { KeyFigure } from "@psx/shared/api/stocks";
import { METRIC_HINTS } from "@psx/shared/market/glossary";
import { formatFinancialPeriod, formatNumber } from "@psx/shared/format";

/**
 * The eight headline figures on the company Overview, in reading order.
 *
 * The web strip and the phone endpoint both call buildKeyFigures, so a reader
 * sees the same number, the same label and the same reason for a withheld
 * value on either surface. The order is fixed: valuation and income first,
 * then growth, then quality, then leverage and cash backing.
 */
export const KEY_FIGURE_DEFS: { key: string; label: string }[] = [
  { key: "P/E", label: "Price to earnings" },
  { key: "Dividend yield (TTM)", label: "Dividend yield" },
  { key: "Revenue growth", label: "Revenue growth" },
  { key: "EPS growth", label: "EPS growth" },
  { key: "Net margin", label: "Net margin" },
  { key: "ROE", label: "Return on equity" },
  { key: "Debt-to-equity", label: "Debt to equity" },
  { key: "OCF / PAT", label: "Cash backing of profit" },
];

export type RatioUnit = "multiple" | "percent" | "ratio" | "amount";

/**
 * How a ratio prints. The engine stores a bare number; the name says whether
 * it is a multiple of price, a percentage or a plain ratio.
 */
export function ratioUnit(name: string): RatioUnit {
  const n = name.toLowerCase();
  if (/^(p\/e|p\/b|p\/s|ev\/|price \/ fcf|dividend cover|equity multiplier|interest coverage|asset turnover|current ratio|quick ratio|cash ratio|net debt-to-equity|debt-to-equity|ocf \/ pat|cash conversion)/.test(n)) {
    return "multiple";
  }
  if (/\/ share|^net debt$|^fcf \(|market cap|shares outstanding|^eps \(|days sales|^accrual|reconciliation/.test(n)) {
    return "amount";
  }
  if (/margin|yield|growth|cagr|ratio|roe|roa|roic|payout|coverage|cost-to-income|advances-to-deposits|receivables|effective tax|change/.test(n)) {
    return "percent";
  }
  return "ratio";
}

/** A ratio value in reader form: "11.3x", "4.59%", "1.24". */
export function formatRatioValue(name: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return formatNumber(null);
  switch (ratioUnit(name)) {
    case "multiple":
      // One decimal, as the company header prints it, so 12.3x is 12.3x everywhere.
      return `${formatNumber(value, 1)}x`;
    case "percent":
      return `${formatNumber(value, 2)}%`;
    case "amount":
      return formatNumber(value, 2);
    default:
      return formatNumber(value, 2);
  }
}

/**
 * The engine's reason for a null value, in plain words.
 *
 * Three cases matter to a reader. A contested filing is under review, so the
 * figure is held back on purpose. A loss-making period has no meaningful
 * earnings multiple. Anything else is a missing input, which the engine names.
 * The engine's own text joins clauses with a dash; the reader gets sentences.
 */
/** A dash used as a clause join (em, en or hyphen with spaces round it). */
const DASH_CLAUSE = /\s[\u2014\u2013-]\s/g;

export function withheldReason(missing: string | null | undefined): string {
  if (!missing) return "Not calculated yet. The filing needed for this figure is not on file.";
  if (/^Contested/i.test(missing)) return missing.replace(DASH_CLAUSE, ", ");
  if (/^Loss-making/i.test(missing)) return "No multiple, loss-making period.";
  return missing
    .replace(/^Cannot calculate\s[\u2014\u2013-]\smissing:/i, "Not calculated. Missing:")
    .replace(/^Cannot calculate\s[\u2014\u2013-]\s/i, "Not calculated. ")
    .replace(DASH_CLAUSE, ", ");
}

/** True when the withheld reason names a contested filing. */
export function isContested(missing: string | null | undefined): boolean {
  return Boolean(missing && /^Contested/i.test(missing));
}

export function buildKeyFigures(ratios: RatioRow[]): KeyFigure[] {
  const byName = new Map(ratios.map((r) => [r.ratio_name, r]));
  return KEY_FIGURE_DEFS.map(({ key, label }) => {
    const row = byName.get(key) ?? null;
    const value = row && row.ratio_value !== null && Number.isFinite(row.ratio_value) ? row.ratio_value : null;
    const period = row ? formatFinancialPeriod(row.source_period) ?? row.source_period ?? null : null;
    return {
      key,
      label,
      value,
      display: formatRatioValue(key, value),
      period,
      hint: METRIC_HINTS[key] ?? "",
      withheld: value === null ? withheldReason(row?.missing) : null,
    };
  });
}
