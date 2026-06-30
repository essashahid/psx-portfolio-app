import { sma, ema, detectSupportResistanceZones, toCanonicalOHLCV, findSwings } from "../../lib/market/technicals";

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
