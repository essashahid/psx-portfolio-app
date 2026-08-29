import { parseMarketWatch, parseSymbol } from "../../lib/market/psx-market-watch";

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

describe("HTML entities in scraped names", () => {
  it("decodes the company name from its data-title attribute", () => {
    // The name arrives from an HTML attribute, so it is entity-encoded and
    // never passes through stripTags. It used to reach the screen as
    // "Oil &amp; Gas Development Company Limited".
    const html = `
      <table>
        <tr>
          <td><a data-title="Oil &amp; Gas Development Company Limited">OGDC</a></td>
          <td>OIL &amp; GAS</td><td>x</td><td>316.30</td><td>317</td><td>325</td>
          <td>315</td><td>318.49</td><td>2.19</td><td>0.69</td><td>1,234</td>
        </tr>
      </table>`;
    const rows = parseMarketWatch(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe("Oil & Gas Development Company Limited");
    expect(rows[0].sectorCode).toBe("OIL & GAS");
  });
});
