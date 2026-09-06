/**
 * Grouping the ratio card into readable sections.
 *
 * getRatioCard returns 52 ratios in the order it computes them, which is fine
 * for a wide table and unreadable as a single column on a phone. The order
 * below is how the questions actually get asked: what is it worth, does it earn
 * anything, what does it owe, can it pay, is it growing, and what did it turn
 * into cash. Anything not named falls to "Other" rather than being dropped, so
 * a new ratio still appears the day it is added.
 */

export const RATIO_GROUPS: { title: string; names: string[] }[] = [
  {
    title: "Valuation",
    names: [
      "P/E",
      "P/E (forward)",
      "Earnings yield",
      "P/B",
      "P/S",
      "EV/Sales",
      "EV/EBIT",
      "FCF yield",
      "Book value / share",
      "Sales / share",
      "Cash / share",
    ],
  },
  {
    title: "Income to you",
    names: ["Dividend yield (TTM)", "Payout ratio", "Dividend cover"],
  },
  {
    title: "Profitability",
    names: [
      "Gross margin",
      "Operating margin",
      "Net margin",
      "FCF margin",
      "ROE",
      "ROA",
      "ROIC",
      "Asset turnover",
      "EPS (TTM)",
      "EPS (annualized)",
    ],
  },
  {
    title: "Debt and cover",
    names: [
      "Debt-to-equity",
      "Net debt-to-equity",
      "Debt / assets",
      "Liabilities / assets",
      "Interest coverage",
    ],
  },
  {
    title: "Liquidity",
    names: ["Current ratio", "Quick ratio", "Cash ratio"],
  },
  {
    title: "Banking",
    names: [
      "Net interest margin",
      "Cost-to-income",
      "Non-markup income ratio",
      "Advances-to-deposits (ADR)",
      "NPL ratio",
    ],
  },
  {
    title: "Growth",
    names: [
      "Revenue growth",
      "Profit growth",
      "EPS growth",
      "Interim EPS growth",
      "Revenue CAGR",
      "EPS CAGR",
      "Gross margin change",
      "Net margin change",
    ],
  },
  {
    title: "Cash and receivables",
    names: [
      "OCF / PAT",
      "Cash conversion",
      "Accrual ratio",
      "Receivables / revenue",
      "Receivables / share",
      "Receivables % of market cap",
      "Days sales outstanding",
    ],
  },
];

/**
 * Buckets ratios into the sections above, keeping each section's declared
 * order. Empty sections are dropped: a bank has no inventory ratios and a
 * producer has no NPL ratio, and an empty heading reads as missing data rather
 * than as a category that does not apply.
 */
export function groupRatios<T extends { name: string }>(
  ratios: T[]
): { title: string; rows: T[] }[] {
  const byName = new Map(ratios.map((row) => [row.name, row]));
  const claimed = new Set<string>();
  const groups: { title: string; rows: T[] }[] = [];

  for (const group of RATIO_GROUPS) {
    const rows: T[] = [];
    for (const name of group.names) {
      const row = byName.get(name);
      if (!row) continue;
      rows.push(row);
      claimed.add(name);
    }
    if (rows.length > 0) groups.push({ title: group.title, rows });
  }

  const rest = ratios.filter((row) => !claimed.has(row.name));
  if (rest.length > 0) groups.push({ title: "Other", rows: rest });
  return groups;
}

/**
 * Ratios that only an analyst reads.
 *
 * Each of these is either a reconciliation the engine runs on itself, a
 * derived intermediate (a share count, a market cap struck from it), or a
 * second-order accrual and cost-structure measure. None of them answers a
 * question a self-directed investor asks, so the reader view leaves them out
 * of the table and shows them under an "Analyst rows" fold. Nothing is
 * deleted: groupRatiosForReader hands them back separately.
 */
export const ANALYST_ONLY_RATIOS: readonly string[] = [
  "Share count reconciliation",
  "Shares outstanding (derived)",
  "Market cap (derived)",
  "EPS (annualized)",
  "Interim EPS growth",
  "Receivables % of market cap",
  "Receivables / share",
  "Retained earnings / assets",
  "Accrual ratio",
  "Equity multiplier",
  "Cost of sales ratio",
  "Operating expense ratio",
];

const ANALYST_ONLY = new Set(ANALYST_ONLY_RATIOS);

/**
 * The ratio table as a reader sees it, on both surfaces.
 *
 * Two rules on top of groupRatios. A group in which every ratio is withheld
 * is dropped, because a null Banking section on an oil producer is not a
 * gap in the data, it is a category that does not apply. And the analyst-only
 * rows are lifted out of every group and returned separately, so the page can
 * fold them away without losing them. "Other" follows the same rules and is
 * never shown empty.
 */
export function groupRatiosForReader<T extends { name: string; value: number | null }>(
  ratios: T[]
): { groups: { title: string; rows: T[] }[]; analyst: T[] } {
  const analyst: T[] = [];
  const reader: T[] = [];
  for (const row of ratios) (ANALYST_ONLY.has(row.name) ? analyst : reader).push(row);

  const groups = groupRatios(reader).filter((group) =>
    group.rows.some((row) => row.value !== null && Number.isFinite(row.value))
  );
  return { groups, analyst };
}
