/**
 * Plain-English, investor-framed one-liners for metrics shown in the UI. Used to
 * power lightweight hover tooltips (native title plus a subtle dotted underline)
 * so a newcomer can learn what a number means without any visual clutter. No
 * icons, no chips, no popovers.
 *
 * Keep each entry short and written for a long-term investor. Say what the number
 * tells you about the business or the valuation. Plain sentences, no em dashes.
 */
export const METRIC_HINTS: Record<string, string> = {
  // Valuation
  "P/E": "Price divided by earnings per share. It shows how many years of current earnings you pay for the stock. Lower is cheaper, but compare within the same sector.",
  "Earnings yield": "Earnings per share divided by price, shown as a percent. It is the inverse of the P/E and tells you how much earnings you get per rupee invested.",
  "P/B": "Price divided by book value per share. Below 1 means you pay less than the company's net assets on the books.",
  "P/S": "Market value divided by revenue. This is useful when earnings are volatile or temporarily depressed.",
  "EV/EBIT": "Enterprise value divided by operating profit. This valuation accounts for debt and cash, not just the share price.",
  "EV/Sales": "Enterprise value divided by revenue, including debt and cash. Lower is cheaper for a given level of sales.",
  "FCF yield": "Free cash flow divided by market value. It shows how much real cash the business produces for each rupee of market value.",
  "Dividend yield (TTM)": "Cash dividends over the last 12 months divided by price. This is the income return at today's price.",
  "Dividend cover": "Earnings per share divided by dividend per share. Above roughly 1.5 to 2 means the payout is comfortably funded.",
  "Payout ratio": "The share of earnings paid out as dividends. A very high payout leaves little for reinvestment.",
  "Book value / share": "Net assets, or equity, per share. This is the accounting value backing each share.",
  "Cash / share": "Cash and equivalents per share. It is a quick read of liquidity. A stock at 65 with 32 of cash per share is well cushioned.",
  "Sales / share": "Revenue per share, the top line scaled to one share.",

  // Receivables
  "Receivables / revenue": "Receivables as a fraction of revenue. A higher figure means more sales are still uncollected, so watch for cash stuck with customers or the government.",
  "Receivables / share": "Money owed to the company per share. Compare it to the price to see how much value is tied up waiting to be collected. OGDC, for example, is owed about 140 rupees per share.",
  "Receivables % of market cap": "How much of the company's entire market value is sitting in uncollected receivables. A large figure means collection is a real catalyst and a real risk.",
  "Days sales outstanding": "The average number of days it takes to collect a sale, calculated as receivables divided by revenue times 365. Rising days mean slower collection. Lower is healthier.",

  // Quality and returns
  "ROE": "Profit divided by equity. It shows how efficiently the company turns shareholder capital into profit. Consistently high is a sign of quality.",
  "ROA": "Profit divided by total assets. It shows the profit generated per rupee of assets, regardless of how they are financed.",
  "ROIC": "After-tax operating profit divided by invested capital. It is the cleanest read of whether the business earns more than its cost of capital.",
  "Gross margin": "Gross profit divided by revenue. It reflects pricing power and production efficiency before overheads.",
  "Operating margin": "Operating profit divided by revenue. It is the profitability of the core business after operating costs.",
  "Net margin": "Profit after tax divided by revenue. It is what is left for shareholders for each rupee of sales.",
  "FCF margin": "Free cash flow divided by revenue. It shows how much of sales converts into spendable cash.",
  "OCF / PAT": "Operating cash flow divided by reported profit. A value near or above 1 means earnings are backed by real cash, not accruals.",
  "Cash conversion": "How well profit turns into operating cash flow. It is a check on earnings quality.",
  "Accrual ratio": "How much of earnings is made up of non-cash accruals. High accruals can flatter reported profit, so lower is cleaner.",
  "Asset turnover": "Revenue divided by assets. It shows how hard the asset base works to generate sales.",
  "Interest coverage": "Operating profit divided by interest expense. It shows how many times over the company can pay its interest. Higher is safer.",

  // Leverage and liquidity
  "Debt-to-equity": "Borrowings divided by equity. It shows how much the company relies on debt versus its own capital.",
  "Net debt-to-equity": "Borrowings minus cash, divided by equity. It is leverage after accounting for cash on hand.",
  "Net debt": "Borrowings minus cash and equivalents. A negative figure means the company holds more cash than debt.",
  "Current ratio": "Current assets divided by current liabilities. Above 1 means short-term assets cover short-term bills.",
  "Quick ratio": "Like the current ratio but it excludes inventory, so it is a stricter test of liquidity.",
  "Cash ratio": "Cash divided by current liabilities. It is the most conservative liquidity measure.",

  // Growth
  "Revenue growth": "The change in revenue versus the prior comparable period.",
  "EPS growth": "The change in earnings per share versus the prior period. Watch for one-off or base-effect spikes.",
  "Revenue CAGR": "Annualised revenue growth over several years, which smooths out single-year noise.",
  "EPS CAGR": "Annualised earnings-per-share growth over several years.",

  // Technicals, framed for the long term
  "RSI (14)": "A momentum gauge from 0 to 100. Readings below about 30 or above 70 flag stretched moves. For a long-term investor this is context, not a trade signal.",
  "Volatility": "The annualised variability of daily returns. Higher means a bumpier ride, so size positions accordingly.",
  "52-wk high": "The highest close over the past year. It tells you whether today's price is extended or pulled back.",
  "52-wk low": "The lowest close over the past year.",
  "20-day MA": "The average close over the last 20 days, a short-term trend reference.",
  "50-day MA": "The average close over the last 50 days, a medium-term trend reference.",
  "100-day MA": "The average close over the last 100 days.",
  "200-day MA": "The average close over the last 200 days, the classic long-term trend line.",
  "Avg volume (30d)": "The average daily shares traded over 30 days, a gauge of liquidity.",
};
