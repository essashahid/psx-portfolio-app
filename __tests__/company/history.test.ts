import { loadCloses } from "../../lib/company/history";

/**
 * PostgREST returns at most 1,000 rows per request whatever the limit says.
 * The loader must keep paging until a short page comes back.
 */
function fakeSupabase(total: number) {
  const calls: [number, number][] = [];
  const rows = Array.from({ length: total }, (_, i) => ({ price_date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`, close: i + 1 }));
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
    },
  };
  return { client: { from: () => chain } as never, calls };
}

describe("loadCloses", () => {
  test("a 1,285-row series comes back whole across two pages", async () => {
    const { client, calls } = fakeSupabase(1285);
    const out = await loadCloses(client, "UBL");
    expect(out).toHaveLength(1285);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
  });

  test("a short series stops after one page", async () => {
    const { client, calls } = fakeSupabase(300);
    const out = await loadCloses(client, "X");
    expect(out).toHaveLength(300);
    expect(calls).toHaveLength(1);
  });
});
