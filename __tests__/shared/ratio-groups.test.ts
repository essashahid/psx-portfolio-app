import { ANALYST_ONLY_RATIOS, RATIO_GROUPS, groupRatios, groupRatiosForReader } from "@psx/shared/company/ratio-groups";

const ratio = (name: string) => ({ name, value: 1 });

describe("groupRatios", () => {
  it("keeps every ratio, including ones no group names", () => {
    const rows = [ratio("P/E"), ratio("ROE"), ratio("Something New")];
    const grouped = groupRatios(rows);
    const seen = grouped.flatMap((g) => g.rows.map((r) => r.name));
    expect(seen.sort()).toEqual(["P/E", "ROE", "Something New"]);
    expect(grouped.at(-1)?.title).toBe("Other");
  });

  it("drops sections with nothing in them", () => {
    // A producer has no NPL ratio; an empty "Banking" heading would read as
    // missing data rather than as a category that does not apply.
    const grouped = groupRatios([ratio("P/E"), ratio("Current ratio")]);
    expect(grouped.map((g) => g.title)).toEqual(["Valuation", "Liquidity"]);
  });

  it("keeps each section's declared order rather than the input order", () => {
    const grouped = groupRatios([ratio("P/B"), ratio("P/E"), ratio("Earnings yield")]);
    expect(grouped[0].rows.map((r) => r.name)).toEqual(["P/E", "Earnings yield", "P/B"]);
  });

  it("names each ratio in at most one group", () => {
    const seen = new Set<string>();
    for (const group of RATIO_GROUPS) {
      for (const name of group.names) {
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    }
  });
});

describe("groupRatiosForReader", () => {
  const withValue = (name: string, value: number | null) => ({ name, value });

  it("keeps Banking for a bank and drops it for a company with nothing in it", () => {
    const bank = groupRatiosForReader([withValue("P/E", 8), withValue("Net interest margin", 4.2), withValue("NPL ratio", null)]);
    expect(bank.groups.map((g) => g.title)).toEqual(["Valuation", "Banking"]);

    const producer = groupRatiosForReader([withValue("P/E", 8), withValue("Net interest margin", null), withValue("NPL ratio", null)]);
    expect(producer.groups.map((g) => g.title)).toEqual(["Valuation"]);
  });

  it("lifts analyst-only rows out of every group and hands them back", () => {
    const { groups, analyst } = groupRatiosForReader([
      withValue("ROE", 18),
      withValue("EPS (annualized)", 12),
      withValue("OCF / PAT", 1.1),
      withValue("Accrual ratio", -3),
      withValue("Share count reconciliation", 0),
    ]);
    const shown = groups.flatMap((g) => g.rows.map((r) => r.name));
    expect(shown).toEqual(["ROE", "OCF / PAT"]);
    expect(analyst.map((r) => r.name).sort()).toEqual(["Accrual ratio", "EPS (annualized)", "Share count reconciliation"]);
    for (const name of ANALYST_ONLY_RATIOS) expect(shown).not.toContain(name);
  });

  it("never shows an empty Other section", () => {
    const { groups } = groupRatiosForReader([withValue("P/E", 8), withValue("Something New", null)]);
    expect(groups.map((g) => g.title)).toEqual(["Valuation"]);

    const withNew = groupRatiosForReader([withValue("P/E", 8), withValue("Something New", 2)]);
    expect(withNew.groups.map((g) => g.title)).toEqual(["Valuation", "Other"]);
  });
});
