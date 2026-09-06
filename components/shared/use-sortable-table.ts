"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Column sorting for tables, extracted from the holdings ledger so every other
 * sortable table can behave the same way.
 *
 * The direction convention comes from that ledger and is deliberate rather than
 * accidental: -1 is the resting state a column lands on when you first click
 * it, and it means "most interesting first". For numbers that is largest first.
 * For text it is A to Z, which is why the string branch inverts the multiplier.
 * A portfolio sorted by value wants the big position at the top; a portfolio
 * sorted by ticker wants ABOT, not WTL.
 *
 * The comparison and the toggle are exported as plain functions so they can be
 * tested without a DOM. The hook is the thin React layer over them.
 *
 * This file knows nothing about holdings, tickers, sectors or money. Callers
 * supply a `getValue` that maps a row and a column key to something comparable.
 */

export type SortDir = -1 | 1;

export type SortState<K extends string> = { key: K; dir: SortDir };

/** What a column returns for sorting. Nulls sort as if they were empty. */
export type SortValue = number | string | null | undefined;

/**
 * Compare two rows on one column. Strings compare with localeCompare so
 * accented tickers and company names order the way a reader expects.
 */
export function compareBy<T, K extends string>(
  a: T,
  b: T,
  getValue: (row: T, key: K) => SortValue,
  { key, dir }: SortState<K>
): number {
  const av = getValue(a, key);
  const bv = getValue(b, key);
  if (typeof av === "string" || typeof bv === "string") {
    return String(av ?? "").localeCompare(String(bv ?? "")) * -dir;
  }
  return ((av ?? 0) - (bv ?? 0)) * dir;
}

/** A new sorted array. The input is not mutated. */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  getValue: (row: T, key: K) => SortValue,
  sort: SortState<K>
): T[] {
  return [...rows].sort((a, b) => compareBy(a, b, getValue, sort));
}

/**
 * Clicking a column: the same column flips direction, a different column
 * takes over and resets to the resting direction.
 */
export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (key === current.key) return { key, dir: current.dir === -1 ? 1 : -1 };
  return { key, dir: -1 };
}

export function useSortableTable<T, K extends string>(
  rows: readonly T[],
  getValue: (row: T, key: K) => SortValue,
  initialKey: K,
  initialDir: SortDir = -1
) {
  const [sort, setSort] = useState<SortState<K>>({ key: initialKey, dir: initialDir });
  const sorted = useMemo(() => sortRows(rows, getValue, sort), [rows, getValue, sort]);
  const sortBy = useCallback((key: K) => setSort((s) => nextSort(s, key)), []);
  return { rows: sorted, sortKey: sort.key, sortDir: sort.dir, sortBy };
}
