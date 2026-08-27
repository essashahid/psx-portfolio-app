import { RATIO_GROUPS, groupRatios } from "@psx/shared/company/ratio-groups";

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
