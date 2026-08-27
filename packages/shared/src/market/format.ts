/** Shared number/label formatting for the Market Pulse UI. */

export function fmtPct(v: number | null | undefined, withSign = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = withSign && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact PKR / share counts: 1.2B, 340.5M, 12.3K. */
export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("en-PK");
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-PK");
}

/** Tone for a change value: positive (green), negative (red), or flat. */
export function tone(v: number | null | undefined): "positive" | "negative" | "flat" {
  if (v == null || v === 0 || !Number.isFinite(v)) return "flat";
  return v > 0 ? "positive" : "negative";
}

/** Background heat colour for a change%, scaled and clamped. Used by the heatmap. */
export function heatColor(changePct: number | null | undefined): string {
  if (changePct == null || !Number.isFinite(changePct) || changePct === 0) return "rgb(113,113,122)"; // zinc-500
  const clamped = Math.max(-7, Math.min(7, changePct));
  const intensity = Math.min(1, Math.abs(clamped) / 5);
  if (clamped > 0) {
    // emerald: lighter → deeper green with magnitude
    const l = 38 - intensity * 14;
    return `hsl(152 55% ${l}%)`;
  }
  const l = 42 - intensity * 14;
  return `hsl(0 62% ${l}%)`;
}
