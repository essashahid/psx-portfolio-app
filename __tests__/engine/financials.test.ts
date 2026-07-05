import { normalizeReportingBasis, statementIdentityViolations } from "@/lib/engine/financials";

describe("normalizeReportingBasis", () => {
  it("normalizes standalone/unconsolidated labels", () => {
    expect(normalizeReportingBasis("Unconsolidated")).toBe("unconsolidated");
    expect(normalizeReportingBasis("standalone")).toBe("unconsolidated");
    expect(normalizeReportingBasis("separate financial statements")).toBe("unconsolidated");
  });

  it("normalizes consolidated and fallback labels", () => {
    expect(normalizeReportingBasis("Group")).toBe("consolidated");
    expect(normalizeReportingBasis("consolidated")).toBe("consolidated");
    expect(normalizeReportingBasis("")).toBe("unlabelled");
    expect(normalizeReportingBasis(null)).toBe("unlabelled");
  });
});

describe("statementIdentityViolations", () => {
  const flags = (r: Parameters<typeof statementIdentityViolations>[0]) =>
    statementIdentityViolations(r).map((v) => v.flag);

  it("passes a self-consistent balance sheet", () => {
    expect(flags({ statement_type: "balance_sheet", data: { total_assets: 1000, total_liabilities: 600, equity: 400 } })).toEqual([]);
  });

  it("flags a balance sheet where assets ≠ liabilities + equity (the ADMM magnitude error)", () => {
    expect(flags({ statement_type: "balance_sheet", data: { total_assets: 220701, total_liabilities: 1500000, equity: 405363 } })).toEqual(["identity:balance_sheet"]);
  });

  it("passes gross profit = revenue − cost of sales within tolerance", () => {
    expect(flags({ statement_type: "income_statement", data: { revenue: 1000, cost_of_sales: 620, gross_profit: 380 } })).toEqual([]);
  });

  it("flags a gross-profit mismatch", () => {
    expect(flags({ statement_type: "income_statement", data: { revenue: 1000, cost_of_sales: 620, gross_profit: 900 } })).toEqual(["identity:gross_profit"]);
  });

  it("accepts PAT under either tax sign convention (expense or credit)", () => {
    // profit-maker: PAT = PBT − tax
    expect(flags({ statement_type: "income_statement", data: { profit_before_tax: 1000, tax: 350, profit_after_tax: 650 } })).toEqual([]);
    // loss-maker with a tax credit: PAT = PBT + tax
    expect(flags({ statement_type: "income_statement", data: { profit_before_tax: -1000, tax: 200, profit_after_tax: -800 } })).toEqual([]);
  });

  it("flags PAT that reconciles under neither convention", () => {
    expect(flags({ statement_type: "income_statement", data: { profit_before_tax: 1000, tax: 350, profit_after_tax: 200 } })).toEqual(["identity:profit_after_tax"]);
  });

  it("never penalises a partial statement for missing inputs", () => {
    expect(flags({ statement_type: "balance_sheet", data: { total_assets: 1000, equity: 400 } })).toEqual([]);
    expect(flags({ statement_type: "income_statement", data: { revenue: 1000, eps: 5 } })).toEqual([]);
  });
});
