import { parseSymbol } from "../../lib/market/psx-market-watch";

describe("PSX market-watch symbol parsing", () => {
  test("reads a plain symbol cell", () => {
    expect(parseSymbol(`<a data-title="Hascol Petroleum">HASCOL</a>`)).toBe("HASCOL");
  });

  test("drops the status badge glued on by tag stripping", () => {
    // NC (non-compliant), XD (ex-dividend), XB (ex-bonus), WU — these appear in
    // a nested element and used to end up inside the ticker itself.
    expect(parseSymbol(`<a>HASCOL</a><span class="badge">NC</span>`)).toBe("HASCOL");
    expect(parseSymbol(`<a>ITANZ</a><span>XB</span>`)).toBe("ITANZ");
    expect(parseSymbol(`<a>MIIETF</a><span>XD</span>`)).toBe("MIIETF");
    expect(parseSymbol(`<a>CJPL</a><span>WU</span>`)).toBe("CJPL");
  });

  test("uppercases and trims", () => {
    expect(parseSymbol(`  <a>  ppl  </a> `)).toBe("PPL");
  });

  test("returns empty for an empty cell", () => {
    expect(parseSymbol(`<span></span>`)).toBe("");
  });
});
