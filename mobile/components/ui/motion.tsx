import { Children, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
} from "react-native-reanimated";
import { duration, ease, useMotion } from "@/lib/motion";
import { layout, palette } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-context";

/**
 * Entrance: an element lifts into place and fades in. The web pairs this with
 * a blur, which is expensive per frame on a phone and reads as a smear rather
 * than focus, so the native version is the lift and the fade only.
 */
export function Rise({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  /** Position in a stagger. Delay stops growing past the fifth. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { ms, delay } = useMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = ease(1, ms("slow"), delay(index));
  }, [progress, ms, delay, index]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 18 }],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/**
 * The same entrance applied to a stack of children, each one a beat behind the
 * last. Runs once per mount: a re-render must not restage it, or a refresh
 * would replay the whole page.
 */
export function Cascade({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      {Children.map(children, (child, i) =>
        child === null || child === undefined || child === false ? child : <Rise index={i}>{child}</Rise>
      )}
    </View>
  );
}

/**
 * A live figure notifying you that it moved: the number tints its own
 * background for a beat and settles. Reserved for a value that changes under
 * you. A figure that counts up on arrival must never also tint — one is an
 * entrance, the other is a notification.
 */
export function Tick({
  value,
  children,
  style,
}: {
  /** Compared against the previous render to decide the direction. */
  value: number | null | undefined;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const { ms } = useMotion();
  const previous = useRef(value);
  const flash = useSharedValue(0);
  const direction = useSharedValue(0);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (before === undefined || before === null || value === undefined || value === null) return;
    if (value === before) return;
    direction.value = value > before ? 1 : -1;
    flash.value = withSequence(ease(1, ms("fast")), ease(0, ms("base")));
  }, [value, flash, direction, ms]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor:
      flash.value === 0
        ? "transparent"
        : direction.value > 0
          ? `rgba(30, 138, 92, ${0.14 * flash.value})`
          : `rgba(179, 45, 45, ${0.14 * flash.value})`,
  }));

  return <Animated.View style={[styles.tick, style, animated]}>{children}</Animated.View>;
}

/**
 * A headline figure counting up once, on arrival. The point is that a changed
 * number is seen moving rather than teleporting, so it animates from the
 * previous figure when there is one and from zero on first paint.
 */
export function CountUp({
  value,
  format,
  style,
}: {
  value: number;
  /** Called on every frame, so it must stay cheap. */
  format: (n: number) => string;
  style?: StyleProp<TextStyle>;
}) {
  const { reduced } = useMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (reduced || start === value) {
      setShown(value);
      return;
    }
    const startedAt = Date.now();
    const step = () => {
      const elapsed = Date.now() - startedAt;
      const t = Math.min(1, elapsed / duration.count);
      // The same shape as the shared curve, expressed as a scalar: fast out of
      // the gate, settling rather than stopping.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(start + (value - start) * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [value, reduced]);

  return <Text style={style}>{format(shown)}</Text>;
}

/**
 * The only pulse in the product: the market is open. It stops at the close,
 * because a pulse running against a stale figure is a claim about freshness
 * the data does not support.
 */
export function LivePulse({ live }: { live: boolean }) {
  const styles = useStyles();
  const { reduced } = useMotion();
  const wave = useSharedValue(0);

  useEffect(() => {
    if (!live || reduced) {
      wave.value = 0;
      return;
    }
    wave.value = withRepeat(ease(1, 2200), -1, false);
  }, [live, reduced, wave]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - Math.min(1, wave.value / 0.7)),
    transform: [{ scale: 1 + wave.value * 1.6 }],
  }));

  return (
    <View style={styles.pulse}>
      {live ? <Animated.View style={[styles.pulseRing, ring]} /> : null}
      <View style={[styles.pulseDot, !live && styles.pulseDotClosed]} />
    </View>
  );
}

/**
 * A waiting state in the shape of the thing it replaces, so nothing reflows
 * when the data lands. A spinner belongs only where the shape is unknown.
 */
export function Shimmer({ width, height, style }: { width?: number | `${number}%`; height: number; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const { reduced } = useMotion();
  const phase = useSharedValue(0.4);

  useEffect(() => {
    if (reduced) return;
    phase.value = withRepeat(withSequence(ease(1, 800), ease(0.4, 800)), -1, false);
  }, [phase, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: phase.value }));

  return <Animated.View style={[styles.shimmer, { width: width ?? "100%", height }, style, animated]} />;
}

const useStyles = makeStyles((c) => ({
  tick: { paddingHorizontal: 5, paddingVertical: 2, marginHorizontal: -5, borderRadius: 3, alignSelf: "flex-start" },
  pulse: { width: 7, height: 7, alignItems: "center", justifyContent: "center" },
  pulseRing: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: layout.radiusPill,
    backgroundColor: palette.up2,
  },
  pulseDot: { width: 7, height: 7, borderRadius: layout.radiusPill, backgroundColor: palette.up2 },
  pulseDotClosed: { backgroundColor: c.textFaint },
  shimmer: { backgroundColor: c.surfaceInset, borderRadius: 3 },
}));
