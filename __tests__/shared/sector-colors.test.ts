import { sectorColor } from "@/lib/shared/sector-colors";

/**
 * Anchors are matched first-wins, so a sector name that sits inside a broader
 * pattern must be listed before it. Getting that order wrong is silent: every
 * oil marketing company rendered in exploration's terracotta across the whole
 * app, and nothing failed.
 *
 * The expected values are the design handoff's own sector table, so this also
 * pins the colours the design was drawn against.
 */
const EXPECTED: [string, string][] = [
  ["Oil & Gas Marketing Companies", "#d9920b"],
  ["Oil & Gas Exploration Companies", "#cd5b2e"],
  ["Refinery", "#b5532a"],
  ["Commercial Banks", "#3450c8"],
  ["Fertiliser", "#5e7d16"],
  ["Cement", "#8a7a66"],
  ["Technology & Communication", "#6a4fd0"],
  ["Pharmaceuticals", "#0f8a8a"],
  ["Power Generation & Distribution", "#c79a1e"],
  ["Automobile Assemblers", "#4a6fa5"],
  ["Insurance", "#8f3fae"],
  ["Textile Composite", "#c23a6b"],
  ["Chemicals", "#0f7e96"],
  ["Glass & Ceramics", "#2f9e8f"],
];

/**
 * Sectors outside the design table that have hit the same first-match trap.
 * These share a hue with their own family by design, so they are checked for
 * the right value but excluded from the distinctness assertion below.
 */
const FAMILY: [string, string][] = [
  // /electric/ belongs to power, but the engineering anchor names "electrical
  // goods" outright and must be tested first.
  ["Cable & Electrical Goods", "#9a6a2e"],
  ["Engineering", "#9a6a2e"],
];

describe("sectorColor", () => {
  it.each([...EXPECTED, ...FAMILY])("maps %s to %s", (sector, color) => {
    expect(sectorColor(sector)).toBe(color);
  });

  it("gives every sector in the design table a distinct colour", () => {
    const colors = EXPECTED.map(([, c]) => c);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("does not confuse marketing with exploration", () => {
    expect(sectorColor("Oil & Gas Marketing Companies")).not.toBe(
      sectorColor("Oil & Gas Exploration Companies")
    );
  });

  it("does not confuse electrical goods with power generation", () => {
    expect(sectorColor("Cable & Electrical Goods")).not.toBe(
      sectorColor("Power Generation & Distribution")
    );
  });

  it("is stable for an unknown sector and neutral for a missing one", () => {
    expect(sectorColor("Some Unlisted Sector")).toBe(sectorColor("Some Unlisted Sector"));
    expect(sectorColor(null)).toBe("#9b9b92");
    expect(sectorColor("  ")).toBe("#9b9b92");
  });
});
