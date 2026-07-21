import { computeBreadth, type PricePanel } from "@/lib/engine/outlook/breadth";

/**
 * Breadth is reconstructed rather than captured, so the risk is not arithmetic
 * but leakage and bias: a moving average that peeks at a future close, or a
 * count whose denominator quietly shifts as listings come and go. These cover
 * those cases.
 */

function panelOf(series: Record<string, { date: string; close: number; volume?: number | null }[]>): PricePanel {
  const panel: PricePanel = new Map();
  for (const [ticker, points] of Object.entries(series)) {
    panel.set(
      ticker,
      points.map((p) => ({ date: p.date, close: p.close, volume: p.volume ?? null }))
    );
  }
  return panel;
}

const D = (n: number) => `2024-01-${String(n).padStart(2, "0")}`;

describe("computeBreadth", () => {
  it("counts advances, declines and flat closes against the previous session", () => {
    const panel = panelOf({
      UP: [{ date: D(1), close: 100 }, { date: D(2), close: 110 }],
      DOWN: [{ date: D(1), close: 100 }, { date: D(2), close: 90 }],
      FLAT: [{ date: D(1), close: 100 }, { date: D(2), close: 100 }],
    });
    const [day] = computeBreadth(panel, [D(2)]);
    expect(day.advancers).toBe(1);
    expect(day.decliners).toBe(1);
    expect(day.unchanged).toBe(1);
    expect(day.counted).toBe(3);
    expect(day.advance_share).toBeCloseTo(1 / 3);
  });

  it("ignores a symbol on its first appearance, which has nothing to compare against", () => {
    // Without this, a new listing registers as a decline (or an advance) purely
    // because it had no prior close, biasing the day it joins.
    const panel = panelOf({
      OLD: [{ date: D(1), close: 100 }, { date: D(2), close: 110 }],
      NEW: [{ date: D(2), close: 50 }],
    });
    const [day] = computeBreadth(panel, [D(2)]);
    expect(day.counted).toBe(1);
    expect(day.advancers).toBe(1);
  });

  it("lets the denominator shrink when a symbol stops trading", () => {
    const panel = panelOf({
      ALIVE: [{ date: D(1), close: 100 }, { date: D(2), close: 110 }, { date: D(3), close: 120 }],
      HALTED: [{ date: D(1), close: 100 }, { date: D(2), close: 90 }],
    });
    const [d2, d3] = computeBreadth(panel, [D(2), D(3)]);
    expect(d2.counted).toBe(2);
    expect(d3.counted).toBe(1);
  });

  it("returns no row for a date where nothing can be counted", () => {
    const panel = panelOf({ ONLY: [{ date: D(1), close: 100 }] });
    expect(computeBreadth(panel, [D(5)])).toHaveLength(0);
  });

  it("computes the moving average from closes at or before the day, never after", () => {
    // 50 rising closes then a spike. On the 50th session the average must use
    // sessions 1-50 only. If it reached forward to the spike, the close would
    // sit below its own average and the symbol would be miscounted.
    const points = Array.from({ length: 50 }, (_, i) => ({
      date: `2024-03-${String(i + 1).padStart(2, "0")}`,
      close: 100 + i,
    }));
    points.push({ date: "2024-03-51", close: 10_000 });
    const panel = panelOf({ TREND: points });
    const rows = computeBreadth(panel, ["2024-03-50"]);
    expect(rows[0].pct_above_ma50).toBe(1);
  });

  it("reports moving-average and extreme shares only once enough history exists", () => {
    const panel = panelOf({
      SHORT: [{ date: D(1), close: 100 }, { date: D(2), close: 110 }],
    });
    const [day] = computeBreadth(panel, [D(2)]);
    expect(day.pct_above_ma50).toBeNull();
    expect(day.pct_above_ma200).toBeNull();
    expect(day.new_highs_52w).toBeNull();
  });

  it("splits volume by the direction of the move", () => {
    const panel = panelOf({
      UP: [{ date: D(1), close: 100 }, { date: D(2), close: 110, volume: 500 }],
      DOWN: [{ date: D(1), close: 100 }, { date: D(2), close: 90, volume: 300 }],
    });
    const [day] = computeBreadth(panel, [D(2)]);
    expect(day.up_volume).toBe(500);
    expect(day.down_volume).toBe(300);
  });

  it("measures dispersion across the cross-section", () => {
    const tight = panelOf({
      A: [{ date: D(1), close: 100 }, { date: D(2), close: 101 }],
      B: [{ date: D(1), close: 100 }, { date: D(2), close: 102 }],
    });
    const wild = panelOf({
      A: [{ date: D(1), close: 100 }, { date: D(2), close: 150 }],
      B: [{ date: D(1), close: 100 }, { date: D(2), close: 60 }],
    });
    const t = computeBreadth(tight, [D(2)])[0].return_dispersion!;
    const w = computeBreadth(wild, [D(2)])[0].return_dispersion!;
    expect(w).toBeGreaterThan(t);
  });
});
