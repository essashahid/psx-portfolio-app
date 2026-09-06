import { buildKeyFigures, isDataGap, KEY_FIGURE_DEFS, readerKeyFigures, withheldReason } from "@/lib/company/key-figures";
import { METRIC_HINTS } from "@psx/shared/market/glossary";
import type { RatioRow } from "@/lib/engine/ratios";

function row(name: string, value: number | null, extra: Partial<RatioRow> = {}): RatioRow {
  return {
    ticker: "TEST",
    ratio_name: name,
    ratio_value: value,
    formula: "",
    inputs: {},
    missing: null,
    source_period: "2025 FY",
    source: null,
    computed_at: "2026-09-01T00:00:00Z",
    ...extra,
  };
}

const EXPECTED_ORDER = [
  "P/E",
  "Dividend yield (TTM)",
  "Revenue growth",
  "EPS growth",
  "Net margin",
  "ROE",
  "Debt-to-equity",
  "OCF / PAT",
];

describe("buildKeyFigures", () => {
  it("always returns the eight figures in a fixed order, even from nothing", () => {
    const empty = buildKeyFigures([]);
    expect(empty.map((f) => f.key)).toEqual(EXPECTED_ORDER);
    expect(KEY_FIGURE_DEFS.map((d) => d.key)).toEqual(EXPECTED_ORDER);

    const shuffled = buildKeyFigures([row("OCF / PAT", 1.1), row("P/E", 9.5), row("ROE", 22)]);
    expect(shuffled.map((f) => f.key)).toEqual(EXPECTED_ORDER);
    expect(shuffled).toHaveLength(8);
  });

  it("formats a shown value and carries its period", () => {
    const [pe, yld] = buildKeyFigures([row("P/E", 11.28), row("Dividend yield (TTM)", 4.59, { source_period: "Last 12 months" })]);
    expect(pe.value).toBe(11.28);
    expect(pe.display).toBe("11.3x");
    expect(pe.period).toBe("FY2025");
    expect(pe.withheld).toBeNull();
    expect(yld.display).toBe("4.59%");
    expect(yld.period).toBe("Last 12 months");
  });

  it("withholds a contested ratio with the engine's reason", () => {
    const reason = "Contested: two readings of the 2025 FY filing disagree on revenue by 12%. Withheld until reviewed.";
    const [, , growth] = buildKeyFigures([row("Revenue growth", null, { missing: reason })]);
    expect(growth.value).toBeNull();
    expect(growth.display).toBe("\u2014");
    expect(growth.withheld).toBe(reason);
  });

  it("gives a loss-making P/E a plain withheld reason", () => {
    const [pe] = buildKeyFigures([
      row("P/E", null, { missing: "Loss-making period \u2014 a price-to-earnings multiple has no meaning against negative earnings." }),
    ]);
    expect(pe.withheld).toBe("No multiple, loss-making period.");
    expect(pe.withheld).not.toMatch(/\u2014/);
  });

  it("names the missing input for any other withheld figure, without a dash", () => {
    const [, , , , , , de] = buildKeyFigures([row("Debt-to-equity", null, { missing: "Cannot calculate \u2014 missing: borrowings, equity." })]);
    expect(de.withheld).toBe("Not calculated. Missing: borrowings, equity.");
    expect(de.withheld).not.toMatch(/\u2014/);
    expect(withheldReason(null)).toMatch(/not on file/);
  });

  it("explains a figure that the engine never produced", () => {
    const [, , , , margin] = buildKeyFigures([]);
    expect(margin.withheld).toMatch(/Not calculated yet/);
  });

  it("takes every hint from the glossary", () => {
    for (const f of buildKeyFigures([])) {
      expect(f.hint).toBe(METRIC_HINTS[f.key]);
      expect(f.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("readerKeyFigures", () => {
  it("hides a figure that is only missing data and keeps contested and loss-making ones", () => {
    const figures = buildKeyFigures([
      row("P/E", null, { missing: "Loss-making period — no multiple." }),
      row("Dividend yield (TTM)", 4.5),
      row("Revenue growth", null, { missing: "Contested: two readings disagree on revenue by 12%." }),
      row("Debt-to-equity", null, { missing: "Cannot calculate — missing: borrowings, equity." }),
    ]);
    const shown = readerKeyFigures(figures).map((f) => f.key);
    expect(shown).toEqual(["P/E", "Dividend yield (TTM)", "Revenue growth"]);
    expect(isDataGap("Not calculated. Missing: borrowings.")).toBe(true);
    expect(isDataGap("Not calculated yet. The filing needed for this figure is not on file.")).toBe(true);
    expect(isDataGap("No multiple, loss-making period.")).toBe(false);
  });
});
