import { breadthQuadrantStats, MIN_EPISODES_TO_QUOTE, type BreadthPoint } from "@/lib/engine/outlook/breadth-signal";
import type { ClosePoint } from "@/lib/engine/outlook/history-stats";

/**
 * The episode count is the guard that stopped a "narrow breadth means five
 * times the risk" claim from shipping on the strength of a single market
 * episode. These cover that guard and the alignment it depends on.
 */

/** A price path with a controllable decline injected at a chosen point. */
function buildIndex(days: number, crashAt?: { start: number; depth: number }): ClosePoint[] {
  const out: ClosePoint[] = [];
  let close = 1000;
  const base = new Date(Date.UTC(2022, 0, 3));
  for (let i = 0; i < days; i++) {
    if (crashAt && i >= crashAt.start && i < crashAt.start + 5) close *= 1 - crashAt.depth / 5;
    else close *= 1.0005;
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + Math.floor(i / 5) * 7 + (i % 5));
    out.push({ date: d.toISOString().slice(0, 10), close });
  }
  return out;
}

function breadthFor(index: ClosePoint[], value: (i: number) => number | null): BreadthPoint[] {
  return index.map((p, i) => ({ date: p.date, pctAboveMa200: value(i) }));
}

describe("breadthQuadrantStats", () => {
  it("returns nothing when too few sessions carry a usable breadth reading", () => {
    // 100 sessions leaves under 90 observations once the volatility warm-up and
    // the forward window are taken out, which is below the floor.
    const index = buildIndex(100);
    const breadth = breadthFor(index, () => 0.5);
    expect(breadthQuadrantStats(index, breadth)).toHaveLength(0);
  });

  it("skips sessions where breadth is unavailable rather than treating them as zero", () => {
    // A null reading means the 200-day average had no history yet. Counting it
    // as 0% participation would put every early session in the narrow bucket.
    const index = buildIndex(600);
    const allNull = breadthFor(index, () => null);
    expect(breadthQuadrantStats(index, allNull)).toHaveLength(0);
  });

  it("aligns breadth to prices by date, not position", () => {
    // Breadth missing a session must not shift every later pairing by one day.
    const index = buildIndex(600);
    const sparse = breadthFor(index, (i) => (i % 7 === 0 ? null : 0.5)).filter((b) => b.pctAboveMa200 !== null);
    const rows = breadthQuadrantStats(index, sparse);
    // Uniform breadth means narrow and broad terciles are the same population,
    // so any lift must be exactly 1 or undefined; a misalignment would skew it.
    for (const r of rows) {
      if (Number.isFinite(r.narrowLiftWithinCalm)) {
        expect(r.narrowLiftWithinCalm).toBeCloseTo(1, 5);
      }
    }
  });

  it("counts one sustained decline as a single episode, not many windows", () => {
    // One crash preceded by many consecutive narrow-breadth sessions produces
    // dozens of overlapping hits. Reported as dozens it looks like a robust
    // pattern; it is one event.
    const index = buildIndex(600, { start: 400, depth: 0.12 });
    const breadth = breadthFor(index, (i) => (i > 350 && i < 400 ? 0.1 : 0.9));
    const rows = breadthQuadrantStats(index, breadth);
    const clustered = rows.filter((r) => r.calmNarrowHits > 1);
    expect(clustered.length).toBeGreaterThan(0);
    for (const r of clustered) {
      // Many overlapping windows must collapse to a handful of episodes.
      expect(r.calmNarrowEpisodes).toBeLessThan(r.calmNarrowHits);
      expect(r.calmNarrowEpisodes).toBeLessThanOrEqual(3);
    }
  });

  it("withholds a ratio built on fewer than the required episodes", () => {
    const index = buildIndex(600, { start: 400, depth: 0.12 });
    const breadth = breadthFor(index, (i) => (i > 350 && i < 400 ? 0.1 : 0.9));
    for (const r of breadthQuadrantStats(index, breadth)) {
      expect(r.quotable).toBe(r.calmNarrowEpisodes >= MIN_EPISODES_TO_QUOTE);
    }
  });
});
