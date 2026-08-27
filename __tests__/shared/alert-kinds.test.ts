import fs from "node:fs";
import path from "node:path";
import { ALERT_KINDS } from "@psx/shared/api/alert-kinds";

describe("ALERT_KINDS", () => {
  it("explains every rule the engine actually emits", () => {
    // The alerts screen tells the user what it is watching for. If a rule is
    // added to the engine and not named here, the screen quietly under-reports
    // what it does, so the two are checked against each other.
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/alerts/refresh.ts"),
      "utf8"
    );
    const emitted = new Set(
      [...source.matchAll(/alert_type:\s*"([a-z_]+)"/g)].map((m) => m[1])
    );
    expect(emitted.size).toBeGreaterThan(0);

    const explained = new Set<string>(ALERT_KINDS.map((entry) => entry.kind));
    const missing = [...emitted].filter((kind) => !explained.has(kind));
    expect(missing).toEqual([]);
  });

  it("names each kind once", () => {
    const kinds = ALERT_KINDS.map((entry) => entry.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
