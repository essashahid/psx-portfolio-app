/**
 * The alerts rule engine against a fake Supabase client.
 *
 * The fake records every query builder chain per table and resolves each
 * with canned rows, so a rule can be checked by what it upserts rather than
 * by driving a database.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAlerts } from "@/lib/alerts/refresh";
import { getPortfolio } from "@/lib/portfolio/positions";

jest.mock("@/lib/portfolio/positions", () => ({
  getPortfolio: jest.fn(),
}));

const mockedPortfolio = getPortfolio as jest.MockedFunction<typeof getPortfolio>;

type Row = Record<string, unknown>;

interface FakeCall {
  table: string;
  op: string | null;
  filters: { method: string; args: unknown[] }[];
  payload?: unknown;
}

/**
 * A chainable, thenable query builder. Every method records itself and
 * returns the same builder; awaiting it resolves with the rows registered
 * for that table (or the upsert payload for `alerts` upserts).
 */
function fakeSupabase(rows: Record<string, Row[]>) {
  const calls: FakeCall[] = [];
  const client = {
    from(table: string) {
      const call: FakeCall = { table, op: null, filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = (method: string) =>
        (...args: unknown[]) => {
          if (method === "upsert" || method === "update" || method === "insert") {
            call.op = method;
            call.payload = args[0];
          } else if (method === "select" && call.op === null) {
            call.op = "select";
            const opts = args[1] as { count?: string } | undefined;
            if (opts?.count) call.op = "count";
          } else {
            call.filters.push({ method, args });
          }
          return builder;
        };
      for (const m of ["select", "eq", "gt", "gte", "lte", "in", "order", "limit", "maybeSingle", "upsert", "update", "insert"]) {
        builder[m] = chain(m);
      }
      builder.then = (resolve: (v: unknown) => void) => {
        if (call.op === "upsert") {
          const payload = call.payload as Row[];
          resolve({ data: payload.map((_, i) => ({ id: `new-${i}` })), error: null });
        } else if (call.op === "count") {
          resolve({ count: 0, error: null });
        } else if (call.op === "update") {
          resolve({ data: null, error: null });
        } else {
          // Honour eq and in filters so a test sees what the query would.
          let data = rows[table] ?? [];
          for (const f of call.filters) {
            if (f.method === "eq") data = data.filter((r) => r[f.args[0] as string] === f.args[1]);
            if (f.method === "in") data = data.filter((r) => (f.args[1] as unknown[]).includes(r[f.args[0] as string]));
          }
          resolve({ data, error: null });
        }
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function holding(ticker: string, extra: Partial<Row> = {}) {
  return {
    ticker,
    quantity: 100,
    has_thesis: false,
    review_date: null,
    latest_price: 100,
    target_price: null,
    review_level: null,
    target_allocation: null,
    weight: 10,
    ...extra,
  };
}

function portfolio(holdings: Row[]) {
  mockedPortfolio.mockResolvedValue({
    holdings,
    sectorWeights: [],
    holdingsCount: holdings.length,
  } as unknown as Awaited<ReturnType<typeof getPortfolio>>);
}

function upserted(calls: FakeCall[]): Row[] {
  const call = calls.find((c) => c.table === "alerts" && c.op === "upsert");
  return (call?.payload as Row[]) ?? [];
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe("refreshAlerts", () => {
  beforeEach(() => {
    mockedPortfolio.mockReset();
  });

  describe("corporate_action_check", () => {
    it("raises an informational alert for a recent unrecorded bonus issue", async () => {
      portfolio([holding("MARI"), holding("OGDC")]);
      const { client, calls } = fakeSupabase({
        company_payouts: [
          { ticker: "MARI", kind: "bonus", announcement_date: daysAgo(20), book_closure_end: daysAgo(10) },
        ],
        transactions: [],
      });

      await refreshAlerts(client, "user-1");

      const alerts = upserted(calls).filter((a) => a.alert_type === "corporate_action_check");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].ticker).toBe("MARI");
      expect(alerts[0].severity).toBe("info");
      expect(alerts[0].dedupe_key).toBe(`corporate_action_check:MARI:bonus:${daysAgo(20)}`);
      expect(alerts[0].message).toMatch(/announced a bonus issue on/);
      expect(alerts[0].message).toMatch(/record it so your cost basis stays right/);
    });

    it("stays quiet once a BONUS transaction dated after the announcement exists", async () => {
      portfolio([holding("MARI")]);
      const { client, calls } = fakeSupabase({
        company_payouts: [
          { ticker: "MARI", kind: "bonus", announcement_date: daysAgo(20), book_closure_end: daysAgo(10) },
        ],
        transactions: [{ user_id: "user-1", ticker: "MARI", type: "BONUS", trade_date: daysAgo(9) }],
      });

      await refreshAlerts(client, "user-1");

      expect(upserted(calls).filter((a) => a.alert_type === "corporate_action_check")).toHaveLength(0);
    });

    it("ignores a transaction dated before the announcement", async () => {
      portfolio([holding("MARI")]);
      const { client, calls } = fakeSupabase({
        company_payouts: [
          { ticker: "MARI", kind: "right", announcement_date: daysAgo(20), book_closure_end: null },
        ],
        transactions: [{ user_id: "user-1", ticker: "MARI", type: "RIGHT", trade_date: daysAgo(200) }],
      });

      await refreshAlerts(client, "user-1");

      const alerts = upserted(calls).filter((a) => a.alert_type === "corporate_action_check");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toMatch(/right issue/);
    });

    it("ignores announcements older than 90 days and cash dividends", async () => {
      portfolio([holding("MARI")]);
      const { client, calls } = fakeSupabase({
        company_payouts: [
          { ticker: "MARI", kind: "bonus", announcement_date: daysAgo(120), book_closure_end: daysAgo(100) },
          { ticker: "MARI", kind: "cash", announcement_date: daysAgo(5), book_closure_end: null },
        ],
        transactions: [],
      });

      await refreshAlerts(client, "user-1");

      expect(upserted(calls).filter((a) => a.alert_type === "corporate_action_check")).toHaveLength(0);
    });

    it("does not query payouts when nothing is held", async () => {
      portfolio([]);
      const { client, calls } = fakeSupabase({});

      await refreshAlerts(client, "user-1");

      expect(calls.some((c) => c.table === "company_payouts")).toBe(false);
    });
  });

  describe("missing_thesis", () => {
    it("is off by default even when the user has written a thesis elsewhere", async () => {
      portfolio([holding("MARI", { has_thesis: true }), holding("OGDC", { has_thesis: false })]);
      const { client, calls } = fakeSupabase({});

      await refreshAlerts(client, "user-1");

      expect(upserted(calls).filter((a) => a.alert_type === "missing_thesis")).toHaveLength(0);
    });

    it("fires only when includeThesisRules is set", async () => {
      portfolio([holding("MARI", { has_thesis: true }), holding("OGDC", { has_thesis: false })]);
      const { client, calls } = fakeSupabase({});

      await refreshAlerts(client, "user-1", { includeThesisRules: true });

      const alerts = upserted(calls).filter((a) => a.alert_type === "missing_thesis");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].ticker).toBe("OGDC");
    });
  });

  it("keeps the concentration rule as it was", async () => {
    portfolio([holding("MARI", { weight: 30 })]);
    const { client, calls } = fakeSupabase({});

    await refreshAlerts(client, "user-1");

    const alerts = upserted(calls).filter((a) => a.alert_type === "concentration_risk");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dedupe_key).toBe("concentration_stock:MARI");
  });
});
