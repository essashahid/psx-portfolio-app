import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { ease, useMotion } from "@/lib/motion";
import { APP_NAME, DISCLAIMER_SHORT } from "@/lib/brand";
import { colors, fontFamily, fontSize, layout, letterSpacing, palette, space, tracking } from "@/lib/theme";

/** The plumb line's full drop, in the 64pt box the mark is drawn in. */
const LINE_LENGTH = 56;
const STROKE = 3.55;

/**
 * The launch sequence: the aperture opens, the plumb line drops through it,
 * the bob lands, the wordmark arrives, the footnote settles. 1180ms in total,
 * the same as the web.
 *
 * The one rule this obeys: animation may only fill waiting that already
 * exists. A cold start reads the stored session and loads three font families
 * before anything can render, so the sequence covers work rather than adding
 * to it, and it is never staged on top of a warm start.
 *
 * Drawn with plain views rather than SVG. Animating SVG props through
 * useAnimatedProps cannot be applied synchronously on the New Architecture:
 * Reanimated fell back for every element on every frame, logging a reflection
 * failure and a full stack trace each time. Transforms and opacity on ordinary
 * views are handled natively, so the same sequence costs nothing.
 */
export function Splash({ onDone }: { onDone?: () => void }) {
  const { reduced } = useMotion();
  const aperture = useSharedValue(0);
  const line = useSharedValue(0);
  const bob = useSharedValue(0);
  const word = useSharedValue(0);
  const foot = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // Land on the final frame rather than playing a shortened version.
      aperture.value = 1;
      line.value = 1;
      bob.value = 1;
      word.value = 1;
      foot.value = 1;
      onDone?.();
      return;
    }
    aperture.value = ease(1, 300);
    line.value = ease(1, 420, 120);
    bob.value = ease(1, 260, 470);
    word.value = ease(1, 280, 640);
    foot.value = ease(1, 240, 880);
    const timer = setTimeout(() => onDone?.(), 1180);
    return () => clearTimeout(timer);
    // Staged once on mount: a re-render must not replay the launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apertureStyle = useAnimatedStyle(() => ({
    opacity: aperture.value,
    transform: [{ scale: 0.86 + aperture.value * 0.14 }],
  }));
  // Scaled from the top edge, so the line reads as dropping through the
  // aperture rather than growing from its middle.
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: line.value }] }));
  const bobStyle = useAnimatedStyle(() => ({ opacity: bob.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: (1 - word.value) * 8 }],
  }));
  const footStyle = useAnimatedStyle(() => ({ opacity: foot.value * 0.9 }));

  return (
    <View style={styles.screen}>
      <View style={styles.centre}>
        <Animated.View style={[styles.mark, apertureStyle]}>
          <View style={styles.square} />
          <Animated.View style={[styles.line, lineStyle]} />
          <Animated.View style={[styles.bob, bobStyle]} />
        </Animated.View>

        <Animated.Text style={[styles.word, wordStyle]}>{APP_NAME}</Animated.Text>
      </View>

      <Animated.View style={[styles.foot, footStyle]}>
        <Text style={styles.footText}>{DISCLAIMER_SHORT}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink, justifyContent: "center", alignItems: "center" },
  centre: { alignItems: "center", gap: space.lg },
  mark: { width: 64, height: 64 },
  square: {
    position: "absolute",
    left: 14,
    top: 14,
    width: 36,
    height: 36,
    borderWidth: STROKE,
    borderColor: colors.textOnDark,
  },
  line: {
    position: "absolute",
    left: (64 - STROKE) / 2,
    top: 4,
    width: STROKE,
    height: LINE_LENGTH,
    backgroundColor: palette.indigo3,
    transformOrigin: "top",
  },
  // The bob hangs at the foot of the line, on the same axis.
  bob: {
    position: "absolute",
    left: 64 / 2 - 3.6,
    top: 60 - 3.6,
    width: 7.2,
    height: 7.2,
    borderRadius: layout.radiusPill,
    backgroundColor: palette.indigo3,
  },
  word: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.h1,
    letterSpacing: letterSpacing(fontSize.h1, tracking.editorial),
    color: colors.textOnDark,
    marginTop: space.md,
  },
  foot: { position: "absolute", bottom: space.xxl, paddingHorizontal: layout.gutter },
  footText: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    lineHeight: 16,
    textAlign: "center",
    color: colors.textOnDarkFaint,
  },
});
