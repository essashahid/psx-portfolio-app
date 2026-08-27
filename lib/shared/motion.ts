/**
 * Reading the motion tokens from JS.
 *
 * Animations driven in JavaScript still have to obey the tokens in
 * globals.css, or the system has two sources of truth and the reduced-motion
 * kill switch only reaches one of them. Because that media query collapses the
 * durations to 0ms, a component reading them here inherits the switch for free
 * and needs no branch of its own.
 */
export function durationToken(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;

  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;

  // Values are authored in ms, but s is valid CSS and would otherwise parse as
  // an absurdly short duration.
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith("ms") ? value : value * 1000;
}
