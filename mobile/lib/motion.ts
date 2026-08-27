import { Easing, useReducedMotion, withDelay, withTiming } from "react-native-reanimated";

/**
 * The motion system, ported from the web app's tokens in app/globals.css so
 * both surfaces move at the same speeds on the same curve.
 *
 * The rules the timings encode:
 *   fast  — press and selection state.
 *   base  — a value that carries meaning changing (a bar width, a tint).
 *   slow  — entrance choreography.
 *   draw  — a chart line drawing itself in.
 *   count — a headline numeral counting up, so a changed figure is seen
 *           moving rather than teleporting.
 *
 * Reduced motion collapses every duration to zero rather than each component
 * branching on its own. A component that needs its own reduced-motion case has
 * the wrong animation.
 */
export const duration = {
  fast: 150,
  base: 300,
  slow: 700,
  draw: 850,
  count: 1300,
} as const;

/** cubic-bezier(0.22, 1, 0.36, 1) — the same --ease-out the web is authored to. */
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Entrance stagger. The web caps the delay at the fifth child because a tenth
 * arriving a second after the first reads as a stall; native runs tighter
 * still, since a phone list that settles slowly reads as lag rather than
 * polish.
 */
const STAGGER_MS = 55;
const STAGGER_CAP = 5;

export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_CAP) * STAGGER_MS;
}

/**
 * The one place a duration is turned off. Every animated component takes its
 * timing from here, so the accessibility setting is honoured everywhere
 * without a per-component branch.
 */
export function useMotion() {
  const reduced = useReducedMotion();
  return {
    reduced,
    /** A duration token, collapsed to zero when the user has asked for less motion. */
    ms: (token: keyof typeof duration) => (reduced ? 0 : duration[token]),
    delay: (index: number) => (reduced ? 0 : staggerDelay(index)),
  };
}

/** withTiming on the shared curve. A zero duration lands on the final frame. */
export function ease(toValue: number, ms: number, delayMs = 0) {
  "worklet";
  const animation = withTiming(toValue, { duration: ms, easing: easeOut });
  return delayMs > 0 ? withDelay(delayMs, animation) : animation;
}
