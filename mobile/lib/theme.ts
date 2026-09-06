import { tone, type Tone } from "@psx/shared/market/format";

/**
 * The design tokens, resolved for React Native.
 *
 * app/globals.css in the web app is the source of truth and the mobile screens
 * in the handoff are built on the same names. CSS variables reference each
 * other; RN has no cascade, so the chains are flattened here. Keep the semantic
 * names identical to the web ones so a screen can be read against its mock.
 *
 * Two palettes. Light mirrors the web app, which is the source of truth. Dark
 * is native to the phone: a true-black field, because an OLED panel draws no
 * power for a black pixel and the app is read in bed as often as at a desk.
 *
 * In light mode the ink header is the darkest surface and lifts off paper. In
 * dark mode that inverts: the page is black and the header is the lighter
 * surface, so the same block still reads as raised rather than dissolving.
 *
 * Screens never import a palette directly. They take colours from useTheme(),
 * so a mode change repaints without a reload.
 */

export const palette = {
  paper0: "#fdfdfc",
  paper1: "#f6f6f4",
  paper2: "#eeefeb",
  paper3: "#e7e8e2",
  paper4: "#dedfda",

  ink0: "#0b0c0b",
  ink1: "#161716",
  ink2: "#3a3b38",
  ink3: "#6c6e68",
  ink4: "#9b9b92",

  navy2: "#101a33",
  indigo1: "#26399a",
  indigo2: "#3450c8",
  indigo3: "#8295e3",
  indigo4: "#eef1fb",
  saffron2: "#d9920b",

  up1: "#0b6b47",
  up2: "#0b8a5c",
  up3: "#34c08c",
  up4: "#e6f4ee",
  down1: "#a32626",
  down2: "#cf3a3a",
  down3: "#e57e7e",
  down4: "#fbeaea",
  flat2: "#9b9b92",
} as const;

export const colors = {
  surfacePage: palette.paper1,
  surfaceRaised: "#ffffff",
  surfaceSunken: palette.paper2,
  surfaceInset: palette.paper3,

  /** The ink field the home header and the login screen sit on. */
  ink: palette.ink1,
  ink2: palette.ink2,

  textStrong: palette.ink1,
  textBody: palette.ink2,
  textMuted: palette.ink3,
  textFaint: palette.ink4,
  textOnDark: "#f2f3f7",
  /** color-mix(#f2f3f7 62%) resolved against the ink field. */
  textOnDarkMuted: "#9fa2ae",
  /** The quieter on-ink tier the mocks use for captions, rgba(242,243,247,0.5). */
  textOnDarkFaint: "#7c7f8b",
  textBrand: palette.indigo2,
  textUp: palette.up1,
  textDown: palette.down1,

  rule: palette.paper4,
  ruleStrong: "#c9cac3",
  /** Hairlines on the ink field, rgba(255,255,255,0.14) resolved. */
  ruleOnDark: "#2c2d2c",

  accentPrimary: palette.indigo2,
  accentSecondary: palette.saffron2,
  brandSoft: palette.indigo4,

  statusOk: palette.up2,
  statusWarn: palette.saffron2,
  statusDanger: palette.down2,
  statusInfo: palette.indigo2,

  chartLine: palette.indigo2,
  chartLineSoft: palette.indigo3,
  chartGrid: "#e6e6df",
  chartAxis: "#82827a",
  chartUp: palette.up2,
  chartDown: palette.down2,
} as const;

/** Every colour role, widened from the light palette's literal types. */
export type Colors = Record<keyof typeof colors, string>;

/**
 * The dark field. Surfaces run black -> near-black rather than paper -> white,
 * and the semantic roles are unchanged so every screen reads the same names.
 *
 * Accents are lifted a step (indigo2 -> indigo3, up2 -> up3) because a colour
 * that carries on paper goes muddy on black; the up/down pair especially has
 * to stay legible at a glance, since it is the first thing read on a holding.
 */
export const darkColors: Colors = {
  surfacePage: "#000000",
  surfaceRaised: "#121212",
  surfaceSunken: "#0a0a0a",
  surfaceInset: "#1c1c1c",

  /** Lighter than the page here, so the header still reads as a raised block. */
  ink: "#161716",
  ink2: "#242523",

  textStrong: "#f2f3f7",
  textBody: "#d6d7dc",
  textMuted: "#9fa2ae",
  textFaint: "#6f7179",
  textOnDark: "#f2f3f7",
  textOnDarkMuted: "#9fa2ae",
  textOnDarkFaint: "#7c7f8b",
  textBrand: palette.indigo3,
  textUp: palette.up3,
  textDown: palette.down3,

  rule: "#232323",
  ruleStrong: "#333333",
  ruleOnDark: "#2c2d2c",

  accentPrimary: palette.indigo2,
  accentSecondary: palette.saffron2,
  brandSoft: "#161d33",

  statusOk: palette.up3,
  statusWarn: palette.saffron2,
  statusDanger: palette.down3,
  statusInfo: palette.indigo3,

  chartLine: palette.indigo3,
  chartLineSoft: palette.indigo2,
  chartGrid: "#1e1e1e",
  chartAxis: "#6f7179",
  chartUp: palette.up3,
  chartDown: palette.down3,
};

/** The web scale is rem against a 16px root. */
export const fontSize = {
  hero: 72,
  display: 48,
  title: 32,
  h1: 24,
  h2: 18,
  h3: 15,
  body: 15,
  sm: 13,
  xs: 12,
  xxs: 11,
  /** --text-3xs, the caps eyebrow size. */
  xxxs: 10,
} as const;

export const tracking = {
  editorial: -0.035,
  tight: -0.02,
  ui: -0.012,
  eyebrow: 0.11,
  caps: 0.08,
} as const;

/** letterSpacing in RN is absolute; the web tracking values are em. */
export function letterSpacing(size: number, em: number): number {
  return size * em;
}

/**
 * Newsreader carries the brand, Manrope runs the interface, Geist Mono runs
 * every figure a reader might compare down a column. Loaded in app/_layout.tsx;
 * the names below are the keys it registers them under.
 */
export const fontFamily = {
  display: "Newsreader_400Regular",
  displayMedium: "Newsreader_500Medium",
  ui: "Manrope_400Regular",
  uiMedium: "Manrope_500Medium",
  uiSemibold: "Manrope_600SemiBold",
  uiBold: "Manrope_700Bold",
  mono: "GeistMono_400Regular",
  monoMedium: "GeistMono_500Medium",
  monoSemibold: "GeistMono_600SemiBold",
} as const;

/** 4px base, matching the web's Tailwind scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  section: 32,
} as const;

export const layout = {
  /** --g: the page gutter. */
  gutter: 16,
  /** An accessibility floor for a finger, so it stays in px. */
  hitMin: 44,
  radiusSm: 6,
  radiusPill: 9999,
  /** Vertical rhythm of a .band section. */
  bandPadY: 20,
} as const;

/**
 * The colour for a tone, looked up in whichever palette is active.
 *
 * The up/down/flat rule itself is tone() in @psx/shared/market/format, the
 * same function the web app uses, so what counts as a gain is decided once.
 * Only the palette lookup is local. Never used decoratively.
 */
export function toneColor(c: Colors, t: Tone): string {
  if (t === "positive") return c.textUp;
  if (t === "negative") return c.textDown;
  return c.textMuted;
}

/** Gains, losses and flat, from the light palette. Prefer toneColor(useColors(), tone(v)). */
export function directionColor(value: number | null | undefined): string {
  return toneColor(colors, tone(value));
}

/** The brighter directional pair, for figures sitting on the ink field. */
export function directionColorOnDark(value: number | null | undefined): string {
  const t = tone(value);
  if (t === "positive") return palette.up3;
  if (t === "negative") return palette.down3;
  return colors.textOnDarkMuted;
}

export const theme = { colors, palette, fontSize, fontFamily, space, layout, tracking } as const;
