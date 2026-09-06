import { summariseBeta, type EventRow } from "../../lib/telemetry/summary";

const now = new Date("2026-09-10T12:00:00Z");
const ev = (name: string, over: Partial<EventRow> = {}): EventRow => ({
  user_id: "u1",
  surface: "web",
  name,
  path: null,
  props: {},
  created_at: "2026-09-09T10:00:00Z",
  ...over,
});

describe("summariseBeta", () => {
  test("counts events, splits surfaces and finds weekly actives", () => {
    const s = summariseBeta(
      [
        ev("page_view", { props: { route: "/dividends" } }),
        ev("page_view", { props: { route: "/holdings" }, surface: "mobile", user_id: "u2" }),
        ev("page_view", { props: { route: "/dividends" }, user_id: "u3", created_at: "2026-08-01T00:00:00Z" }),
        ev("chat_asked", { props: { mode: "explain" } }),
        ev("chat_asked", { props: { mode: "advise" }, user_id: "u2" }),
        ev("company_viewed", { props: { held: true } }),
        ev("company_viewed", { props: { held: false } }),
      ],
      [
        { user_id: "u1", source: "manual" },
        { user_id: "u1", source: "transactions" },
        { user_id: "u2", source: "statement" },
      ],
      now
    );
    expect(s.count("chat_asked")).toBe(2);
    expect(s.propCount("chat_asked", "mode")).toBe("explain 1, advise 1");
    expect(s.propValue("company_viewed", "held", true)).toBe(1);
    expect(s.routeViews("/dividends")).toBe(2);
    expect(s.bySurface).toEqual({ web: 6, mobile: 1 });
    expect(s.weeklyActive).toBe(2);
    expect(s.usersWithHoldings).toBe(2);
    expect(s.holdingsBySource).toEqual({ manual: 1, transactions: 1, import: 1 });
  });

  test("empty input gives zeros, not errors", () => {
    const s = summariseBeta([], [], now);
    expect(s.count("page_view")).toBe(0);
    expect(s.topRoutes).toEqual([]);
    expect(s.propCount("chat_asked", "mode")).toBe("");
  });
});
