import { sma, ema, detectSupportResistanceZones, toCanonicalOHLCV, findSwings, swingThresholdFor } from "../../lib/market/technicals";

/** Deterministic pseudo-random walk, so the volatility tests do not flake. */
function walk(n: number, dailyVolPct: number, start = 100) {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const out = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    price *= 1 + (rand() * dailyVolPct) / 100;
    const d = new Date(Date.UTC(2022, 0, 3) + i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, close: Number(price.toFixed(2)), volume: 1000 });
  }
  return out;
}

describe("Market Technicals", () => {
  describe("Indicators", () => {
    test("SMA calculates correctly", () => {
      const values = [1, 2, 3, 4, 5];
      expect(sma(values, 3)).toBe(4); // (3+4+5)/3
      expect(sma(values, 5)).toBe(3); // (1+2+3+4+5)/5
      expect(sma(values, 6)).toBeNull(); // not enough values
    });

    test("EMA calculates correctly", () => {
      const values = Array.from({ length: 10 }, (_, i) => i + 1);
      const res = ema(values, 3);
      expect(res).not.toBeNull();
      expect(res).toBeGreaterThan(8);
      expect(res).toBeLessThan(10);
    });
  });

  describe("Support/Resistance Engine", () => {
    test("detects clusters from swings", () => {
      const candles = [
        { date: "2026-06-01", close: 100, volume: 1000 },
        { date: "2026-06-02", close: 110, volume: 1000 },
        { date: "2026-06-03", close: 105, volume: 1000 },
        { date: "2026-06-04", close: 112, volume: 1000 },
        { date: "2026-06-05", close: 104, volume: 1000 }
      ];
      
      const swings = [
        { index: 1, date: "2026-06-02", price: 110, kind: "high" as const },
        { index: 2, date: "2026-06-03", price: 105, kind: "low" as const },
        { index: 3, date: "2026-06-04", price: 112, kind: "high" as const },
        { index: 4, date: "2026-06-05", price: 104, kind: "low" as const },
      ];

      const currentPrice = 110;
      const zones = detectSupportResistanceZones(candles, swings, currentPrice);
      
      expect(zones.length).toBeGreaterThan(0);
      expect(zones[0].kind).toBe("resistance");
      expect(zones[0].touches).toBe(2);
      expect(zones[0].confidence).toBe("Low"); // 2 touches = low
    });

    test("drops levels far from the current price", () => {
      // A pre-split style history: old pivots near 4, price now near 50.
      const candles = walk(600, 2, 50);
      const swings = [
        { index: 10, date: candles[10].date, price: 4.1, kind: "high" as const },
        { index: 20, date: candles[20].date, price: 4.2, kind: "high" as const },
        { index: 30, date: candles[30].date, price: 0.9, kind: "low" as const },
        { index: 40, date: candles[40].date, price: 0.85, kind: "low" as const },
      ];
      const zones = detectSupportResistanceZones(candles, swings, 50);
      expect(zones).toHaveLength(0);
    });

    test("never merges a cluster that spans an implausible range", () => {
      // The old absolute tolerance let a cluster drift from 0.85 up to 4.33.
      const candles = walk(300, 2, 50);
      const swings = [0.85, 1.6, 2.4, 3.2, 4.33].map((price, i) => ({
        index: i, date: candles[i].date, price, kind: "low" as const,
      }));
      const zones = detectSupportResistanceZones(candles, swings, 50);
      for (const z of zones) {
        expect((z.high - z.low) / ((z.high + z.low) / 2)).toBeLessThan(0.2);
      }
    });

    test("classifies by position relative to price, not pivot kind", () => {
      const candles = walk(300, 2, 100);
      // Two former highs that price has since broken above act as support.
      const swings = [
        { index: 5, date: candles[5].date, price: 90, kind: "high" as const },
        { index: 15, date: candles[15].date, price: 91, kind: "high" as const },
      ];
      const zones = detectSupportResistanceZones(candles, swings, 100);
      expect(zones).toHaveLength(1);
      expect(zones[0].kind).toBe("support");
    });

    test("caps the number of zones returned", () => {
      const candles = walk(600, 2, 100);
      const swings = Array.from({ length: 60 }, (_, i) => ({
        index: i * 8,
        date: candles[i * 8].date,
        price: 85 + (i % 20),
        kind: (i % 2 ? "high" : "low") as "high" | "low",
      }));
      const zones = detectSupportResistanceZones(candles, swings, 100);
      expect(zones.length).toBeLessThanOrEqual(8);
    });
  });

  describe("Swing detection", () => {
    test("threshold scales with realized volatility", () => {
      const calm = swingThresholdFor(walk(400, 1));
      const wild = swingThresholdFor(walk(400, 8));
      expect(wild).toBeGreaterThan(calm);
      expect(calm).toBeGreaterThanOrEqual(8);
      expect(wild).toBeLessThanOrEqual(25);
    });

    test("a volatile series yields far fewer swings than a flat 8% threshold", () => {
      const candles = walk(1000, 6);
      expect(findSwings(candles).length).toBeLessThan(findSwings(candles, 8).length / 2);
    });

    test("pivots land on the true extremes, not the bar before the breakout", () => {
      // Opens at its high of 100, falls 20% to 80, then rallies. Both turning
      // points must be reported at their exact extreme.
      const closes = [100, 96, 92, 88, 84, 80, 88, 96, 104, 112, 120];
      const candles = closes.map((close, i) => ({
        date: new Date(Date.UTC(2026, 0, 5) + i * 86400000).toISOString().slice(0, 10),
        close, volume: 1000,
      }));
      const swings = findSwings(candles, 8);
      expect(swings[0]).toMatchObject({ kind: "high", price: 100 });
      expect(swings[1]).toMatchObject({ kind: "low", price: 80 });
    });
  });

  describe("Canonical OHLCV Conversion", () => {
    test("toCanonicalOHLCV converts close-only correctly", () => {
      const candles = [
        { date: "2026-06-01", close: 100, volume: 1000 },
        { date: "2026-06-02", close: 105, volume: 2000 }
      ];

      const canonical = toCanonicalOHLCV("FCCL", candles);

      expect(canonical.symbol).toBe("FCCL");
      expect(canonical.bars.length).toBe(2);
      expect(canonical.bars[0].open).toBe(100);
      expect(canonical.bars[0].high).toBe(100);
      expect(canonical.bars[0].low).toBe(100);
      expect(canonical.bars[0].close).toBe(100);
      expect(canonical.bars[0].volume).toBe(1000);
      expect(canonical.bars[0].status).toBe("unverified");
      expect(canonical.dataQuality).toBe("close-only");
    });
  });
});
