import { normalizeReportingBasis } from "@/lib/engine/financials";

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
