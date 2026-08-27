import { isMarketOpen } from "@psx/shared/market/trading-day";

/**
 * The pulse is the product's only claim that a figure is live. If it runs when
 * the exchange is shut, it is a lie about freshness — so the boundaries are
 * pinned here rather than left to a glance at the clock.
 *
 * Dates are UTC; PKT is UTC+5 with no daylight saving.
 */
const at = (utc: string) => new Date(utc);

describe("isMarketOpen", () => {
  it("is open through the session", () => {
    // 2026-08-26 is a Wednesday. 06:00Z = 11:00 PKT.
    expect(isMarketOpen(at("2026-08-26T06:00:00Z"))).toBe(true);
  });

  it("opens at 09:30 PKT, not before", () => {
    expect(isMarketOpen(at("2026-08-26T04:29:00Z"))).toBe(false); // 09:29
    expect(isMarketOpen(at("2026-08-26T04:30:00Z"))).toBe(true); // 09:30
  });

  it("closes at 15:30 PKT", () => {
    expect(isMarketOpen(at("2026-08-26T10:29:00Z"))).toBe(true); // 15:29
    expect(isMarketOpen(at("2026-08-26T10:30:00Z"))).toBe(false); // 15:30
  });

  it("is shut overnight", () => {
    expect(isMarketOpen(at("2026-08-26T20:00:00Z"))).toBe(false); // 01:00 PKT
  });

  it("is shut at the weekend even during session hours", () => {
    // 2026-08-29 is a Saturday, 2026-08-30 a Sunday.
    expect(isMarketOpen(at("2026-08-29T06:00:00Z"))).toBe(false);
    expect(isMarketOpen(at("2026-08-30T06:00:00Z"))).toBe(false);
  });

  it("is open again on Monday", () => {
    expect(isMarketOpen(at("2026-08-31T06:00:00Z"))).toBe(true);
  });
});
