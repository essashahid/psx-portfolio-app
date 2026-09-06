import { utcDayStart, overDailyCap, DAILY_MESSAGE_CAP } from "../../lib/chat/daily-cap";

describe("daily cap", () => {
  test("utcDayStart is midnight UTC of the given instant", () => {
    expect(utcDayStart(new Date("2026-09-06T23:59:59Z"))).toBe("2026-09-06T00:00:00.000Z");
    expect(utcDayStart(new Date("2026-09-06T00:00:01Z"))).toBe("2026-09-06T00:00:00.000Z");
  });

  test("the cap is 40 and inclusive", () => {
    expect(DAILY_MESSAGE_CAP).toBe(40);
    expect(overDailyCap(39)).toBe(false);
    expect(overDailyCap(40)).toBe(true);
    expect(overDailyCap(41)).toBe(true);
  });
});
