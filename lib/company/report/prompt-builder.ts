import type { CompanyReportOptions } from "./types";

/** Builds sector-aware analysis guidance for the AI prompt. */
export function buildSectorGuidance(sector: string | null): string {
  if (!sector) return "";
  const s = sector.toLowerCase();

  if (s.includes("cement")) {
    return `Sector guidance (Cement):
- Focus on dispatch volumes, capacity utilization, retention prices, and coal/energy costs.
- Note the domestic-export mix and regional pricing dynamics.
- Monitor government infrastructure spending and construction activity.
- Key risks: coal prices, energy costs, overcapacity, seasonal demand.`;
  }

  if (s.includes("bank") || s.includes("commercial")) {
    return `Sector guidance (Banking):
- Focus on net interest margin, non-performing loans ratio, CASA ratio, capital adequacy.
- Note spread on earning assets and cost of deposits.
- Monitor policy rate changes and their impact on NII.
- Key metrics: advances growth, deposits growth, coverage ratio.`;
  }

  if (s.includes("fertilizer")) {
    return `Sector guidance (Fertilizer):
- Focus on urea and DAP pricing, offtake volumes, gas allocation.
- Note government subsidy structures and their impact on margins.
- Monitor agriculture sector conditions and crop outlook.`;
  }

  if (s.includes("oil") || s.includes("gas") || s.includes("energy")) {
    return `Sector guidance (Oil & Gas / Energy):
- Focus on production volumes, per-barrel revenue, and exploration success.
- Note crude oil and RLNG price sensitivity.
- Monitor circular debt levels and collection rates for utilities.`;
  }

  if (s.includes("textile")) {
    return `Sector guidance (Textile):
- Focus on export volumes, yarn/fabric margins, and cotton prices.
- Note exchange rate impact on export competitiveness.
- Monitor global demand and energy cost impact on cost structure.`;
  }

  if (s.includes("pharma")) {
    return `Sector guidance (Pharmaceutical):
- Focus on regulated pricing, product portfolio, and market share.
- Note DRAP pricing actions and their margin impact.
- Monitor raw material import costs and currency effects.`;
  }

  if (s.includes("auto") || s.includes("assembler")) {
    return `Sector guidance (Automobile):
- Focus on volumetric sales, localization levels, pricing power.
- Note CKD/SKD import dependency and currency impact.
- Monitor auto financing conditions and interest rate sensitivity.`;
  }

  if (s.includes("power") || s.includes("generation")) {
    return `Sector guidance (Power Generation):
- Focus on capacity payments, fuel mix, and dispatch factors.
- Note tariff structure and circular debt exposure.
- Monitor government energy policy and privatization plans.`;
  }

  if (s.includes("technology") || s.includes("communication")) {
    return `Sector guidance (Technology):
- Focus on export revenue, headcount growth, and utilization rates.
- Note currency benefit on export earnings.
- Monitor global IT spending trends and contract pipeline.`;
  }

  return `Sector: ${sector}. Analyze using appropriate sector-specific metrics and drivers.`;
}

/** Builds portfolio-aware guidance when user holds a position. */
export function buildPortfolioPromptGuidance(portfolio: {
  held: boolean;
  quantity?: number;
  avgCost?: number;
  totalReturn?: number | null;
  dividendIncome?: number | null;
  priceReturnPct?: number | null;
}): string {
  if (!portfolio.held) {
    return "The user does NOT currently hold a position in this stock. Focus on company analysis and valuation.";
  }
  return `The user holds ${portfolio.quantity ?? "?"} shares at an average cost of PKR ${portfolio.avgCost?.toFixed(2) ?? "n/a"}.
Price return: ${portfolio.priceReturnPct?.toFixed(1) ?? "n/a"}%. Total return (incl. dividends): ${portfolio.totalReturn?.toFixed(1) ?? "n/a"}%.
Dividend income received: PKR ${portfolio.dividendIncome?.toLocaleString() ?? "n/a"}.
In the portfolio section, analyze the position in the context of the company's fundamentals and outlook.`;
}

/** Builds a structured evidence summary for section-level regeneration. */
export function buildSectionPrompt(
  sectionKey: string,
  ticker: string,
  options: CompanyReportOptions,
  sector: string | null
): string {
  const sectorGuide = buildSectorGuidance(sector);
  const base = `Regenerate only the "${sectionKey}" section for ${ticker}.
${sectorGuide}
Use only the structured evidence provided. Cite source IDs. Do NOT invent data.
Each insight must be highly detailed, exhaustive, company-specific, and substantive. Do NOT limit your word count.`;

  switch (sectionKey) {
    case "financials":
      return `${base}
Focus on: revenue trend, profitability changes, margin analysis, EPS trajectory.
Cite specific financial figures from the evidence.`;
    case "valuation":
      return `${base}
Focus on: current P/E and P/B relative to peers, dividend yield, historical valuation range.
Note both absolute and relative valuation positioning.`;
    case "catalystsRisks":
      return `${base}
Provide at least 2 catalysts and 2 risks. Each must be company-specific (not generic macro).
Catalysts should reference positive trends or upcoming events from evidence.
Risks should reference financial weaknesses, sector headwinds, or operational concerns.`;
    case "portfolio":
      return `${base}
Analyze the user's position: cost basis vs current price, return attribution (price vs dividends).
Note portfolio concentration and sector allocation implications.`;
    default:
      return base;
  }
}
