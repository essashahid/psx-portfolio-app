import { indexContributors, marketVerdict, type SummaryRow } from "@/lib/market/summary";

const row = (ticker: string, sectorLabel: string, changePct: number | null, marketCap: number, name: string | null = null): SummaryRow => ({
  ticker,
  name,
  sectorLabel,
  changePct,
  marketCap,
});

describe("marketVerdict", () => {
  it("describes an up day with the count, the value share and the sectors", () => {
    const sentence = marketVerdict([
      row("OGDC", "Energy", 2.0, 400),
      row("PPL", "Energy", 1.0, 300),
      row("MEBL", "Banks", 0.5, 200),
      row("LUCK", "Cement", -1.5, 100),
    ]);
    expect(sentence).toBe(
      "3 of 4 companies rose and 90% of market value sits in names that gained. Energy carried the market and Cement weighed most on it."
    );
  });

  it("describes a down day from the decliners' side", () => {
    const sentence = marketVerdict([
      row("OGDC", "Energy", -2.0, 400),
      row("PPL", "Energy", -1.0, 300),
      row("MEBL", "Banks", 0.5, 200),
      row("LUCK", "Cement", -1.5, 100),
    ]);
    expect(sentence).toBe(
      "3 of 4 companies fell and only 20% of market value sits in names that gained. Energy weighed most on the market and Banks held up best."
    );
  });

  it("calls an even split a mixed day", () => {
    const sentence = marketVerdict([
      row("OGDC", "Energy", 1.0, 100),
      row("MEBL", "Banks", -1.0, 100),
      row("FFC", "Fertiliser", 0, 100),
    ]);
    expect(sentence).toBe(
      "A mixed day: 1 company rose and 1 fell, with 33% of market value in names that gained. Energy led and Banks lagged."
    );
  });

  it("does not name a best and worst sector when there is only one", () => {
    const sentence = marketVerdict([row("OGDC", "Energy", 1.0, 100), row("PPL", "Energy", 2.0, 100)]);
    expect(sentence).toBe("2 of 2 companies rose and 100% of market value sits in names that gained. Energy set the tone.");
  });

  it("returns null for empty or unpriced input", () => {
    expect(marketVerdict([])).toBeNull();
    expect(marketVerdict([row("X", "Energy", 1, 0)])).toBeNull();
  });
});

describe("indexContributors", () => {
  it("scales each company's move by its weight and sorts by absolute points", () => {
    const rows = [
      row("OGDC", "Energy", 2.0, 500, "Oil and Gas Development"),
      row("MEBL", "Banks", -3.0, 250),
      row("LUCK", "Cement", 1.0, 250),
    ];
    const out = indexContributors(rows, 100_000);
    expect(out.map((c) => c.ticker)).toEqual(["OGDC", "MEBL", "LUCK"]);
    expect(out[0].points).toBeCloseTo(1000, 6);
    expect(out[0].name).toBe("Oil and Gas Development");
    expect(out[1].points).toBeCloseTo(-750, 6);
    expect(out[2].points).toBeCloseTo(250, 6);
    expect(out[2].changePct).toBe(1.0);
  });

  it("caps the list at seven", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`T${i}`, "Energy", i + 1, 100));
    const out = indexContributors(rows, 50_000);
    expect(out).toHaveLength(7);
    expect(out[0].ticker).toBe("T11");
    expect(out[6].ticker).toBe("T5");
  });

  it("handles empty input and a missing index level", () => {
    expect(indexContributors([], 100_000)).toEqual([]);
    expect(indexContributors([row("X", "Energy", 1, 100)], null)).toEqual([]);
    expect(indexContributors([row("X", "Energy", 1, 0)], 100_000)).toEqual([]);
  });
});
