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
