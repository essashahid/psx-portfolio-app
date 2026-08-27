import { recomputeHoldingsFromTransactions } from "@/lib/portfolio/positions";

/**
 * A stand-in for the Supabase client, recording what the rebuild asks it to
 * delete. Only the calls this function makes are modelled.
 */
function fakeSupabase({
  transactions,
  holdings,
}: {
  transactions: Record<string, unknown>[];
  holdings: { ticker: string; source: string }[];
}) {
  const deleted: string[] = [];

  const builder = (table: string) => {
    const state: { op: string; tickers?: string[] } = { op: "" };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        // The sweep narrows the holdings read to rows it owns.
        if (table === "holdings" && column === "source") state.tickers = holdings.filter((h) => h.source === value).map((h) => h.ticker);
        if (table === "holdings" && column === "ticker" && state.op === "delete") deleted.push(String(value));
        return chain;
      },
      in: (_column: string, values: string[]) => {
        if (state.op === "delete") deleted.push(...values);
        return chain;
      },
      order: () => Promise.resolve({ data: transactions, error: null }),
      update: () => chain,
      upsert: () => Promise.resolve({ error: null }),
      delete: () => {
        state.op = "delete";
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) =>
        resolve({
          data: table === "holdings" ? (state.tickers ?? []).map((ticker) => ({ ticker })) : [],
          error: null,
        }),
    };
    return chain;
  };

  return { client: { from: (table: string) => builder(table) }, deleted };
}

const buy = (ticker: string) => ({
  id: `${ticker}-1`,
  ticker,
  trade_date: "2026-01-10",
  type: "BUY",
  quantity: 100,
  price: 50,
  gross_amount: null,
  commission: null,
  tax: null,
  net_amount: 5000,
});

describe("recomputeHoldingsFromTransactions", () => {
  it("removes a position whose last transaction was deleted", async () => {
    // OGDC still trades; FFC's only transaction has gone, so nothing in the
    // ledger mentions it and the rebuild never visits that ticker on its own.
    const { client, deleted } = fakeSupabase({
      transactions: [buy("OGDC")],
      holdings: [
        { ticker: "OGDC", source: "transactions" },
        { ticker: "FFC", source: "transactions" },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recomputeHoldingsFromTransactions(client as any, "user-1");

    expect(deleted).toContain("FFC");
    expect(deleted).not.toContain("OGDC");
  });

  it("leaves a hand-added position alone", async () => {
    // A holding that was never derived from the ledger must not be deleted
    // because the ledger is silent about it.
    const { client, deleted } = fakeSupabase({
      transactions: [buy("OGDC")],
      holdings: [
        { ticker: "OGDC", source: "transactions" },
        { ticker: "MARI", source: "manual" },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recomputeHoldingsFromTransactions(client as any, "user-1");

    expect(deleted).not.toContain("MARI");
  });
});
