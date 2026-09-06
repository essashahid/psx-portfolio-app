import { compareBy, nextSort, sortRows, type SortValue } from "../../components/shared/use-sortable-table";

/**
 * The sorting half of useSortableTable is exported as plain functions so it can
 * be tested here without a DOM. The React wrapper around them is three lines.
 *
 * The cases below are the holdings ledger's semantics, which this logic was
 * extracted from: -1 is the resting direction, meaning largest-first for
 * numbers and A-to-Z for text.
 */

type Row = { ticker: string; qty: number; price: number | null; value: number };
type Key = "ticker" | "qty" | "price" | "value";

const rows: Row[] = [
  { ticker: "OGDC", qty: 300, price: 210.5, value: 63_150 },
  { ticker: "ABOT", qty: 100, price: null, value: 91_000 },
  { ticker: "MARI", qty: 50, price: 1_800, value: 90_000 },
];

const get = (r: Row, k: Key): SortValue =>
  k === "ticker" ? r.ticker : k === "qty" ? r.qty : k === "price" ? (r.price ?? 0) : r.value;

const tickers = (rs: Row[]) => rs.map((r) => r.ticker);

describe("sortRows", () => {
  test("numbers sort largest first in the resting direction", () => {
    expect(tickers(sortRows(rows, get, { key: "value", dir: -1 }))).toEqual(["ABOT", "MARI", "OGDC"]);
  });

  test("numbers reverse when the direction flips", () => {
    expect(tickers(sortRows(rows, get, { key: "value", dir: 1 }))).toEqual(["OGDC", "MARI", "ABOT"]);
  });

  test("text sorts A to Z in the resting direction, not Z to A", () => {
    expect(tickers(sortRows(rows, get, { key: "ticker", dir: -1 }))).toEqual(["ABOT", "MARI", "OGDC"]);
  });

  test("text reverses when the direction flips", () => {
    expect(tickers(sortRows(rows, get, { key: "ticker", dir: 1 }))).toEqual(["OGDC", "MARI", "ABOT"]);
  });

  test("a null value sorts as zero rather than throwing or drifting to an end", () => {
    // ABOT has no price. Largest first puts MARI, then OGDC, then the null.
    expect(tickers(sortRows(rows, get, { key: "price", dir: -1 }))).toEqual(["MARI", "OGDC", "ABOT"]);
    expect(tickers(sortRows(rows, get, { key: "price", dir: 1 }))).toEqual(["ABOT", "OGDC", "MARI"]);
  });

  test("the input array is not mutated", () => {
    const before = tickers(rows);
    sortRows(rows, get, { key: "value", dir: -1 });
    expect(tickers(rows)).toEqual(before);
  });

  test("an empty list stays empty", () => {
    expect(sortRows([], get, { key: "value", dir: -1 })).toEqual([]);
  });

  test("negative numbers order correctly, so a loss sits below a gain", () => {
    const pl = [{ t: "A", v: -500 }, { t: "B", v: 1_200 }, { t: "C", v: 0 }];
    const byV = (r: { t: string; v: number }) => r.v;
    expect(sortRows(pl, byV, { key: "v", dir: -1 }).map((r) => r.t)).toEqual(["B", "C", "A"]);
  });
});

describe("compareBy", () => {
  // A descending comparison of two equal numbers yields -0, which Object.is
  // separates from 0 even though === does not. Sorting cannot tell them apart,
  // so these assert "compares as equal" rather than a particular zero.
  test("equal values compare as equal, so the original order is kept", () => {
    const a = { ticker: "AAA", qty: 10, price: 1, value: 5 };
    const b = { ticker: "BBB", qty: 10, price: 1, value: 5 };
    expect(compareBy(a, b, get, { key: "qty", dir: -1 }) === 0).toBe(true);
  });

  test("a missing value and an explicit zero compare as equal", () => {
    const missing = { ticker: "AAA", qty: 0, price: null, value: 0 };
    const zero = { ticker: "BBB", qty: 0, price: 0, value: 0 };
    const raw = (r: Row, k: Key): SortValue => (k === "price" ? r.price : r.value);
    expect(compareBy(missing, zero, raw, { key: "price", dir: -1 }) === 0).toBe(true);
  });
});

describe("nextSort", () => {
  test("clicking the active column flips its direction", () => {
    expect(nextSort<Key>({ key: "value", dir: -1 }, "value")).toEqual({ key: "value", dir: 1 });
    expect(nextSort<Key>({ key: "value", dir: 1 }, "value")).toEqual({ key: "value", dir: -1 });
  });

  test("clicking a different column takes over and resets to the resting direction", () => {
    expect(nextSort<Key>({ key: "value", dir: 1 }, "ticker")).toEqual({ key: "ticker", dir: -1 });
  });
});
