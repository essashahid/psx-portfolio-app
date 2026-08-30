/**
 * Squarified treemap layout.
 *
 * Rectangles are chosen to be as close to square as possible, because area is
 * only judged accurately when the shape is compact: a long thin sliver of the
 * same area reads as smaller than a square one. The algorithm is Bruls, Huizing
 * and van Wijk's, which greedily adds items to a row while the worst aspect
 * ratio in that row keeps improving, then starts a new row.
 *
 * Pure and free of React so it can be unit tested and memoised by the caller.
 */

export type Sized<T> = { value: number; item: T };
export type Tile<T> = { item: T; x: number; y: number; w: number; h: number };

function worstRatio<T>(row: Sized<T>[], sum: number, total: number, w: number, h: number): number {
  const side = (w >= h ? w : h) * (sum / total);
  const cross = w >= h ? h : w;
  let worst = 0;
  for (const it of row) {
    const c = cross * (it.value / sum);
    if (c <= 0 || side <= 0) return Infinity;
    worst = Math.max(worst, Math.max(side / c, c / side));
  }
  return worst;
}

export function squarify<T>(items: Sized<T>[], x: number, y: number, w: number, h: number): Tile<T>[] {
  const out: Tile<T>[] = [];
  let list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);

  while (list.length && w > 0.5 && h > 0.5) {
    const total = list.reduce((n, i) => n + i.value, 0);
    const horizontal = w >= h;
    let row = [list[0]];
    let sum = list[0].value;
    let current = worstRatio(row, sum, total, w, h);
    let i = 1;
    while (i < list.length) {
      const nextSum = sum + list[i].value;
      const nextRow = row.concat([list[i]]);
      const next = worstRatio(nextRow, nextSum, total, w, h);
      if (next > current) break;      // adding this one makes the row worse
      row = nextRow;
      sum = nextSum;
      current = next;
      i += 1;
    }
    const fraction = sum / total;
    if (horizontal) {
      const rw = w * fraction;
      let cy = y;
      for (const it of row) {
        const rh = h * (it.value / sum);
        out.push({ item: it.item, x, y: cy, w: rw, h: rh });
        cy += rh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = h * fraction;
      let cx = x;
      for (const it of row) {
        const rw = w * (it.value / sum);
        out.push({ item: it.item, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
    list = list.slice(row.length);
  }
  return out;
}

/**
 * Mix two hex colours. React Native has no color-mix(), and the fills have to
 * be blended against whichever surface the theme is currently painting, so the
 * interpolation is done here.
 */
export function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => {
    const v = hex.replace("#", "");
    const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const a = parse(from);
  const b = parse(to);
  const k = Math.max(0, Math.min(1, amount));
  const out = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}
