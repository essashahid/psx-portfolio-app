import { pickEffectivePrice, OVERRIDE_SOURCES } from "../../lib/portfolio/effective-price";

/**
 * The one rule both the portfolio and the company header call. If these hold,
 * the two surfaces cannot disagree, because they are the same function fed
 * the same rows.
 */
const quote = { price: 100, date: "2026-09-04", source: "psx-dps" };
const close = { price: 99, date: "2026-09-03", source: "psx-dps" };

describe("pickEffectivePrice", () => {
  test("the shared quote wins over an older close", () => {
    expect(pickEffectivePrice({ quote, close })).toMatchObject({ price: 100, kind: "quote" });
  });

  test("a close newer than the quote wins, because the quote refresh fell behind", () => {
    const newer = { price: 101, date: "2026-09-05", source: "psx-dps" };
    expect(pickEffectivePrice({ quote, close: newer })).toMatchObject({ price: 101, kind: "close" });
  });

  test("a manual price at least as new as the market wins", () => {
    const manual = { price: 95, date: "2026-09-04", source: "manual" };
    expect(pickEffectivePrice({ userRow: manual, quote, close })).toMatchObject({ price: 95, kind: "override" });
  });

  test("a manual price older than the market loses to the market", () => {
    const manual = { price: 95, date: "2026-08-01", source: "manual" };
    expect(pickEffectivePrice({ userRow: manual, quote, close })).toMatchObject({ price: 100, kind: "quote" });
  });

  test("a statement price is an override too", () => {
    expect(OVERRIDE_SOURCES.has("statement")).toBe(true);
    const stmt = { price: 97, date: "2026-09-04", source: "statement" };
    expect(pickEffectivePrice({ userRow: stmt, quote })).toMatchObject({ kind: "override", price: 97 });
  });

  test("a legacy provider row in the per-user table is the last resort, never an override", () => {
    const legacy = { price: 90, date: "2026-09-06", source: "psx-dps" };
    expect(pickEffectivePrice({ userRow: legacy, quote })).toMatchObject({ price: 100, kind: "quote" });
    expect(pickEffectivePrice({ userRow: legacy })).toMatchObject({ price: 90, kind: "legacy" });
  });

  test("nothing usable gives null rather than a zero", () => {
    expect(pickEffectivePrice({})).toBeNull();
    expect(pickEffectivePrice({ quote: { price: 0, date: "2026-09-04", source: "x" } })).toBeNull();
    expect(pickEffectivePrice({ quote: { price: NaN, date: "2026-09-04", source: "x" } })).toBeNull();
  });

  test("the portfolio path and the header path agree on every combination", () => {
    // The two callers pass identical candidate shapes; resolve twice and compare.
    const rows = [undefined, quote, { ...quote, date: "2026-09-02" }];
    const users = [undefined, { price: 95, date: "2026-09-04", source: "manual" }, { price: 80, date: "2026-01-01", source: "manual" }, { price: 91, date: "2026-09-06", source: "psx-dps" }];
    const closes = [undefined, close, { price: 102, date: "2026-09-05", source: "psx-dps" }];
    let compared = 0;
    for (const q of rows) for (const u of users) for (const c of closes) {
      const a = pickEffectivePrice({ userRow: u, quote: q, close: c });
      const b = pickEffectivePrice({ close: c, quote: q, userRow: u });
      expect(a).toEqual(b);
      compared++;
    }
    expect(compared).toBe(36);
  });
});
