import { contestedFromConflicts, contestedReason, CONTESTED_PCT } from "../../lib/engine/contested";

const conflict = (over: Partial<{ statement_type: string; fiscal_year: number; fiscal_period: string; differences: unknown }> = {}) => ({
  statement_type: "income_statement",
  fiscal_year: 2025,
  fiscal_period: "FY",
  differences: [{ field: "eps", existing: 22.59, incoming: 52.53, abs_delta: 29.94, pct_delta: 57 }],
  ...over,
});

describe("contestedFromConflicts", () => {
  test("a large disagreement on a headline field is contested", () => {
    const set = contestedFromConflicts([conflict()]);
    expect(set.isContested("income_statement", 2025, "FY", "eps")).toBe(true);
    expect(set.size).toBe(1);
  });

  test("a small revision is not", () => {
    const set = contestedFromConflicts([conflict({ differences: [{ field: "eps", pct_delta: CONTESTED_PCT - 1 }] })]);
    expect(set.size).toBe(0);
  });

  test("a non-headline field is ignored however large", () => {
    const set = contestedFromConflicts([conflict({ differences: [{ field: "inventory", pct_delta: 400 }] })]);
    expect(set.size).toBe(0);
  });

  test("the period is part of the key, so an old dispute does not blank a new figure", () => {
    const set = contestedFromConflicts([conflict({ fiscal_year: 2021 })]);
    expect(set.isContested("income_statement", 2025, "FY", "eps")).toBe(false);
    expect(set.isContested("income_statement", 2021, "FY", "eps")).toBe(true);
  });

  test("period labels compare case-insensitively", () => {
    const set = contestedFromConflicts([conflict({ fiscal_period: "fy" })]);
    expect(set.isContested("income_statement", 2025, "FY", "eps")).toBe(true);
  });

  test("malformed rows are skipped, not thrown on", () => {
    const set = contestedFromConflicts([conflict({ differences: null }), conflict({ differences: [null, "x", { field: 3 }] })]);
    expect(set.size).toBe(0);
  });

  test("fieldsFor lists every contested field on one row", () => {
    const set = contestedFromConflicts([
      conflict({ differences: [{ field: "eps", pct_delta: 30 }, { field: "revenue", pct_delta: 20 }, { field: "tax", pct_delta: 90 }] }),
    ]);
    expect(set.fieldsFor("income_statement", 2025, "FY").map((e) => e.field).sort()).toEqual(["eps", "revenue"]);
  });

  test("the reason names the period, the field and the size, in plain words", () => {
    const e = contestedFromConflicts([conflict()]).entries()[0];
    expect(contestedReason(e)).toBe("Contested: two readings of the 2025 FY filing disagree on eps by 57%. Withheld until reviewed.");
  });
});
