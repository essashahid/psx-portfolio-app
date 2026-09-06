import { normaliseSbpDate, parseSbpRows, fetchSbpSeries } from "../../lib/market-data/sbp-easydata";

/**
 * EasyData is not strict about field casing or which key carries the date, and
 * its payload has been documented both as a bare array and wrapped in { data }.
 * The parser accepts that spread, so these pin what it will and will not take.
 *
 * The one rule underneath all of them: a row that cannot be read as a dated
 * number is dropped, never guessed at. Fabricated macro values are what Phase 2
 * is removing.
 */

describe("normaliseSbpDate", () => {
  test("accepts an ISO date unchanged", () => {
    expect(normaliseSbpDate("2026-06-30")).toBe("2026-06-30");
  });

  test("a month resolves to its first day", () => {
    expect(normaliseSbpDate("2026-06")).toBe("2026-06-01");
  });

  test("day-month-year, the Pakistani convention, is read the right way round", () => {
    expect(normaliseSbpDate("30-06-2026")).toBe("2026-06-30");
  });

  test("nonsense and non-strings give nothing rather than a wrong date", () => {
    expect(normaliseSbpDate("not a date")).toBeNull();
    expect(normaliseSbpDate(null)).toBeNull();
    expect(normaliseSbpDate(42)).toBeNull();
  });
});

describe("parseSbpRows", () => {
  test("reads the documented shape", () => {
    expect(parseSbpRows([{ date: "2026-06-30", value: 11.5 }]))
      .toEqual([{ date: "2026-06-30", value: 11.5 }]);
  });

  test("accepts the alternative field names and casing", () => {
    expect(parseSbpRows([{ OBSERVATION_DATE: "2026-06-30", OBS_VALUE: "11.5" }]))
      .toEqual([{ date: "2026-06-30", value: 11.5 }]);
  });

  test("strips thousands separators from a numeric string", () => {
    expect(parseSbpRows([{ date: "2026-06-30", value: "1,234.5" }])[0].value).toBe(1234.5);
  });

  test("points come back in date order however they arrive", () => {
    const out = parseSbpRows([
      { date: "2026-06-30", value: 2 },
      { date: "2026-01-31", value: 1 },
    ]);
    expect(out.map((p) => p.date)).toEqual(["2026-01-31", "2026-06-30"]);
  });

  test("undated or unreadable rows are dropped, not defaulted to zero", () => {
    const out = parseSbpRows([
      { date: "2026-06-30", value: 11.5 },
      { date: "2026-07-31", value: "n/a" },
      { value: 9 },
      null,
      "junk",
    ]);
    expect(out).toEqual([{ date: "2026-06-30", value: 11.5 }]);
  });

  test("a non-array payload yields nothing rather than throwing", () => {
    expect(parseSbpRows(undefined)).toEqual([]);
    expect(parseSbpRows({ data: [] })).toEqual([]);
  });
});

describe("fetchSbpSeries", () => {
  const KEY = process.env.SBP_EASYDATA_API_KEY;
  afterEach(() => {
    if (KEY === undefined) delete process.env.SBP_EASYDATA_API_KEY;
    else process.env.SBP_EASYDATA_API_KEY = KEY;
  });

  test("says it is not configured rather than inventing a series", async () => {
    delete process.env.SBP_EASYDATA_API_KEY;
    await expect(fetchSbpSeries("ANY", "2026-01-01", "2026-06-30"))
      .resolves.toEqual({ ok: false, reason: "not-configured" });
  });

  test("a key with no series key is reported separately, so the two are diagnosable apart", async () => {
    process.env.SBP_EASYDATA_API_KEY = "test-key";
    await expect(fetchSbpSeries(null, "2026-01-01", "2026-06-30"))
      .resolves.toEqual({ ok: false, reason: "no-series" });
  });
});
