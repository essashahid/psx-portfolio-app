import type { SupabaseClient } from "@supabase/supabase-js";
import { quickAddHolding, QuickAddError } from "../../lib/portfolio/quick-add";

/**
 * Onboarding's "Add what you own" has two paths and the difference matters:
 * with a cost the position must come from the ledger, so it is one model with
 * every other trade; without one it is a manual row that reads back as
 * "cost unknown". These pin both against a fake Supabase in the style of
 * __tests__/import/commit-idempotency.test.ts: enough of the query builder
 * for recomputeHoldingsFromTransactions to run for real on top of it.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private single = false;
  private pending: (() => void) | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  gt(col: string, val: number) {
    this.filters.push((r) => Number(r[col]) > val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  insert(row: Row | Row[]) {
    const rows = Array.isArray(row) ? row : [row];
    for (const r of rows) this.db.rows(this.table).push({ id: `${this.table}-${this.db.nextId++}`, ...r });
    return this;
  }
  upsert(row: Row, opts: { onConflict: string }) {
    const keys = opts.onConflict.split(",");
    const rows = this.db.rows(this.table);
    const i = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
    if (i >= 0) rows[i] = { ...rows[i], ...row };
    else rows.push({ id: `${this.table}-${this.db.nextId++}`, ...row });
    return this;
  }
  update(patch: Row) {
    this.pending = () => {
      for (const r of this.matching()) Object.assign(r, patch);
    };
    return this;
  }
  delete() {
    this.pending = () => {
      const keep = this.db.rows(this.table).filter((r) => !this.filters.every((f) => f(r)));
      this.db.tables.set(this.table, keep);
    };
    return this;
  }
  private matching() {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }
  then<T>(resolve: (v: { data: unknown; error: null }) => T) {
    if (this.pending) {
      this.pending();
      return Promise.resolve(resolve({ data: null, error: null }));
    }
    const rows = this.matching().map((r) => ({ ...r }));
    return Promise.resolve(resolve({ data: this.single ? (rows[0] ?? null) : rows, error: null }));
  }
}

class FakeDb {
  tables = new Map<string, Row[]>();
  nextId = 1;
  rows(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  client(): SupabaseClient {
    return { from: (table: string) => new FakeQuery(this, table) } as unknown as SupabaseClient;
  }
}

function seeded() {
  const db = new FakeDb();
  db.rows("stock_master").push({ ticker: "MEBL", company_name: "Meezan Bank", sector: "Commercial Banks" });
  db.rows("stock_universe").push({ ticker: "NEWCO", company_name: "New Company", sector: "Technology" });
  return db;
}

describe("quick-add with a known average cost", () => {
  test("writes a BUY and derives the holding from the ledger", async () => {
    const db = seeded();
    const out = await quickAddHolding(db.client(), "u1", { ticker: "mebl", quantity: 100, avgCost: 250 });
    expect(out).toEqual({ ok: true, ticker: "MEBL", path: "ledger" });

    const txns = db.rows("transactions");
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ user_id: "u1", ticker: "MEBL", type: "BUY", quantity: 100, price: 250, source: "manual" });

    const holdings = db.rows("holdings");
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      ticker: "MEBL",
      quantity: 100,
      avg_cost: 250,
      total_cost: 25_000,
      source: "transactions",
      company_name: "Meezan Bank",
      sector: "Commercial Banks",
    });
  });

  test("a second add for the same ticker averages through the ledger, not by overwriting", async () => {
    const db = seeded();
    await quickAddHolding(db.client(), "u1", { ticker: "MEBL", quantity: 100, avgCost: 200 });
    await quickAddHolding(db.client(), "u1", { ticker: "MEBL", quantity: 100, avgCost: 300 });
    expect(db.rows("transactions")).toHaveLength(2);
    expect(db.rows("holdings")).toHaveLength(1);
    expect(db.rows("holdings")[0]).toMatchObject({ quantity: 200, avg_cost: 250, total_cost: 50_000 });
  });
});

describe("quick-add without a cost", () => {
  test("writes a manual holding with zero cost and no transaction", async () => {
    const db = seeded();
    const out = await quickAddHolding(db.client(), "u1", { ticker: "MEBL", quantity: 50, avgCost: null });
    expect(out).toEqual({ ok: true, ticker: "MEBL", path: "manual" });
    expect(db.rows("transactions")).toHaveLength(0);
    expect(db.rows("holdings")).toHaveLength(1);
    expect(db.rows("holdings")[0]).toMatchObject({
      ticker: "MEBL",
      quantity: 50,
      avg_cost: 0,
      total_cost: 0,
      source: "manual",
      company_name: "Meezan Bank",
      sector: "Commercial Banks",
    });
  });

  test("a later priced buy replaces the unknown-cost row through the recompute", async () => {
    const db = seeded();
    await quickAddHolding(db.client(), "u1", { ticker: "MEBL", quantity: 50, avgCost: null });
    await quickAddHolding(db.client(), "u1", { ticker: "MEBL", quantity: 50, avgCost: 100 });
    expect(db.rows("holdings")).toHaveLength(1);
    // The ledger only knows about the 50 bought at 100; the earlier 50 with no
    // cost had no trade behind them, so the derived row is the ledger's view.
    expect(db.rows("holdings")[0]).toMatchObject({ quantity: 50, avg_cost: 100, source: "transactions" });
  });

  test("falls back to stock_universe for a company not yet in stock_master", async () => {
    const db = seeded();
    await quickAddHolding(db.client(), "u1", { ticker: "NEWCO", quantity: 10, avgCost: null });
    expect(db.rows("holdings")[0]).toMatchObject({ ticker: "NEWCO", company_name: "New Company", sector: "Technology" });
  });
});

describe("quick-add validation", () => {
  const db = seeded();
  test("an unknown ticker is refused before anything is written", async () => {
    await expect(quickAddHolding(db.client(), "u1", { ticker: "NOPE", quantity: 10, avgCost: 5 })).rejects.toBeInstanceOf(QuickAddError);
    expect(db.rows("transactions")).toHaveLength(0);
    expect(db.rows("holdings")).toHaveLength(0);
  });

  test("zero shares, a zero cost and a malformed ticker are all refused", async () => {
    await expect(quickAddHolding(db.client(), "u1", { ticker: "MEBL", quantity: 0, avgCost: null })).rejects.toBeInstanceOf(QuickAddError);
    await expect(quickAddHolding(db.client(), "u1", { ticker: "MEBL", quantity: 10, avgCost: 0 })).rejects.toBeInstanceOf(QuickAddError);
    await expect(quickAddHolding(db.client(), "u1", { ticker: "M", quantity: 10, avgCost: null })).rejects.toBeInstanceOf(QuickAddError);
  });
});
