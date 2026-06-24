/**
 * Stable per-sector colour system.
 *
 * The point is consistency: a given PSX sector reads as the *same* colour
 * everywhere it appears (allocation donut, holdings table, daily move list,
 * market sector bars), so the eye learns "indigo = banks, terracotta = oil"
 * across the whole platform. Colours are tuned to sit calmly on the warm paper
 * background and to blend with the editorial chart palette in `chart-kit.tsx`.
 *
 * Anchors cover the common PSX sectors by keyword match (so naming variants
 * like "Oil & Gas Exploration Companies" still land on the same hue). Anything
 * unmatched falls back to a deterministic pick from a harmonised ring, so even
 * unknown sectors stay stable across renders.
 */

export const UNCLASSIFIED_COLOR = "#9b9b92";

const ANCHORS: { match: RegExp; color: string }[] = [
  { match: /bank|microfinance/, color: "#3450c8" },           // banks — editorial indigo
  { match: /fertiliz|fertili/, color: "#5e7d16" },            // fertiliser — olive
  { match: /oil.*(explorat|gas)|exploration/, color: "#cd5b2e" }, // E&P — terracotta
  { match: /oil.*market|gas.*market|marketing/, color: "#d9920b" }, // OMC — amber
  { match: /refiner/, color: "#b5532a" },                     // refinery — burnt orange
  { match: /power|electric|energy/, color: "#c79a1e" },       // power — gold
  { match: /cement/, color: "#8a7a66" },                      // cement — stone
  { match: /tech|communicat|software|telecom/, color: "#6a4fd0" }, // tech — violet
  { match: /pharma|health/, color: "#0f8a8a" },               // pharma — teal
  { match: /chemical/, color: "#0f7e96" },                    // chemicals — deep cyan
  { match: /automobile assembler|auto.*assembl|automobile$/, color: "#4a6fa5" }, // autos — slate blue
  { match: /automobile part|auto.*part|tyre|tractor/, color: "#6f8bb5" }, // auto parts — light slate
  { match: /textile|spinning|weaving|synthetic|rayon/, color: "#c23a6b" }, // textile — rose
  { match: /food|personal care|sugar|vanaspati|dairy/, color: "#0b8a5c" }, // food — emerald
  { match: /engineering|steel|cable|electrical goods/, color: "#9a6a2e" }, // engineering — bronze
  { match: /insurance|takaful/, color: "#8f3fae" },           // insurance — plum
  { match: /invest|leasing|modaraba|mutual fund/, color: "#4060b0" }, // financials — muted blue
  { match: /glass|ceramic/, color: "#2f9e8f" },               // glass — aqua
  { match: /paper|board/, color: "#7a8a5e" },                 // paper — sage
  { match: /tobacco/, color: "#8c2f39" },                     // tobacco — maroon
  { match: /transport|airline|shipping/, color: "#5a7a8c" },  // transport — steel
  { match: /real estate|reit|propert/, color: "#b06a4a" },    // real estate — brick
  { match: /conglomerate|holding|miscellaneous|diversif/, color: "#6b6b64" }, // mixed — neutral
];

// Harmonised fallback ring for sectors that match no anchor.
const RING = [
  "#3450c8", "#0b8a5c", "#d9920b", "#cd5b2e", "#8f3fae",
  "#0f7e96", "#5e7d16", "#c23a6b", "#6a4fd0", "#2f9e8f",
  "#9a6a2e", "#4a6fa5", "#b5532a", "#0f8a8a", "#c79a1e", "#5a7a8c",
];

/** Stable colour for a sector name. Returns a neutral tone when missing. */
export function sectorColor(sector?: string | null): string {
  if (!sector || !sector.trim()) return UNCLASSIFIED_COLOR;
  const s = sector.toLowerCase();
  for (const a of ANCHORS) if (a.match.test(s)) return a.color;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return RING[h % RING.length];
}

/** Hex + alpha (0–1) → 8-digit hex, for faint tinted backgrounds. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** Inline styles for a sector chip: colored dot, faint tint, legible text. */
export function sectorChipStyle(sector?: string | null): {
  dot: string;
  background: string;
  color: string;
} {
  const c = sectorColor(sector);
  return {
    dot: c,
    background: withAlpha(c, 0.1),
    // darken toward foreground so light hues stay readable on the tint
    color: `color-mix(in oklab, ${c} 68%, var(--foreground))`,
  };
}
