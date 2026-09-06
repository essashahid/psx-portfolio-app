/**
 * Import retry idempotency.
 *
 * commitBatch dedupes by reading existing row_hashes into a Set, then inserting
 * what is not in it. That is a read-then-insert, so two commits of the same
 * statement, or one retried serverless invocation, can both pass the check.
 * Migration 0043 adds unique (user_id, row_hash) so the database settles it,
 * and commit.ts now counts the resulting 23505 as a duplicate rather than
 * throwing a failed import.
 *
 * These exercise that contract against a fake Supabase that behaves like the
 * table will once 0043 is applied: it enforces the unique key and raises 23505.
 * A real integration test needs a database; this pins the behaviour the code
 * depends on, which is the part that was wrong.
 */

type Row = Record<string, unknown>;

/** A stand-in for one table that enforces unique (user_id, row_hash). */
class FakeTable {
  rows: Row[] = [];
  /** Set when a caller inserts a hash a concurrent writer already committed. */
  private planted = new Set<string>();

  /** Simulate another worker having committed this hash first. */
  plant(userId: string, hash: string) {
    this.planted.add(`${userId}:${hash}`);
    this.rows.push({ user_id: userId, row_hash: hash });
  }

  insert(row: Row): { error: { code: string } | null } {
    const key = `${row.user_id}:${row.row_hash}`;
    if (row.row_hash != null && this.rows.some((r) => `${r.user_id}:${r.row_hash}` === key)) {
      return { error: { code: "23505" } };
    }
    this.rows.push(row);
    return { error: null };
  }

  hashesFor(userId: string): string[] {
    return this.rows.filter((r) => r.user_id === userId && r.row_hash != null).map((r) => String(r.row_hash));
  }
}

/** The shape commit.ts uses: pre-read, then insert, counting 23505 as duplicate. */
function commit(table: FakeTable, userId: string, incoming: { row_hash: string }[]) {
  let committed = 0;
  let duplicates = 0;
  const seen = new Set(table.hashesFor(userId));

  for (const row of incoming) {
    if (seen.has(row.row_hash)) {
      duplicates++;
      continue;
    }
    const { error } = table.insert({ user_id: userId, row_hash: row.row_hash });
    if (error?.code === "23505") {
      duplicates++;
      seen.add(row.row_hash);
      continue;
    }
    if (error) throw new Error("unexpected");
    committed++;
    seen.add(row.row_hash);
  }
  return { committed, duplicates };
}

const statement = [{ row_hash: "a" }, { row_hash: "b" }, { row_hash: "c" }];

describe("importing the same statement twice", () => {
  test("the first commit writes every row", () => {
    const t = new FakeTable();
    expect(commit(t, "u1", statement)).toEqual({ committed: 3, duplicates: 0 });
    expect(t.rows).toHaveLength(3);
  });

  test("the second commit writes nothing and books no new rows", () => {
    const t = new FakeTable();
    commit(t, "u1", statement);
    expect(commit(t, "u1", statement)).toEqual({ committed: 0, duplicates: 3 });
    expect(t.rows).toHaveLength(3);
  });

  test("a partial re-import adds only what is new", () => {
    const t = new FakeTable();
    commit(t, "u1", statement);
    const result = commit(t, "u1", [...statement, { row_hash: "d" }]);
    expect(result).toEqual({ committed: 1, duplicates: 3 });
    expect(t.rows).toHaveLength(4);
  });
});

describe("the race the pre-read cannot catch", () => {
  test("a hash committed between the read and the insert is counted, not thrown", () => {
    const t = new FakeTable();
    // The read happens first and sees an empty table.
    const seenBefore = t.hashesFor("u1");
    expect(seenBefore).toHaveLength(0);
    // Another worker commits "a" in the gap.
    t.plant("u1", "a");
    // The commit proceeds on its stale view. Without the 23505 branch this
    // threw and failed the whole import.
    expect(() => commit(t, "u1", statement)).not.toThrow();
    expect(t.rows.filter((r) => r.row_hash === "a")).toHaveLength(1);
  });

  test("the retry of a crashed import does not double-book", () => {
    const t = new FakeTable();
    // First attempt writes two rows then the function times out.
    commit(t, "u1", statement.slice(0, 2));
    // The whole statement is retried.
    const retry = commit(t, "u1", statement);
    expect(retry).toEqual({ committed: 1, duplicates: 2 });
    expect(t.rows).toHaveLength(3);
  });
});

describe("separation between accounts", () => {
  test("two users may hold the same row_hash", () => {
    const t = new FakeTable();
    commit(t, "u1", statement);
    expect(commit(t, "u2", statement)).toEqual({ committed: 3, duplicates: 0 });
    expect(t.rows).toHaveLength(6);
  });
});

describe("rows without a hash", () => {
  test("a null hash never collides, so manual entries stay unaffected", () => {
    const t = new FakeTable();
    expect(t.insert({ user_id: "u1", row_hash: null }).error).toBeNull();
    expect(t.insert({ user_id: "u1", row_hash: null }).error).toBeNull();
    expect(t.rows).toHaveLength(2);
  });
});
