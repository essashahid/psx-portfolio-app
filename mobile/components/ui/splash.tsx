import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { ease, useMotion } from "@/lib/motion";
import { APP_NAME, DISCLAIMER_SHORT } from "@/lib/brand";
import { colors, fontFamily, fontSize, layout, letterSpacing, palette, space, tracking } from "@/lib/theme";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Length of the plumb line, for the stroke-dash draw-in. */
const LINE_LENGTH = 56;

/**
 * The launch sequence: the aperture opens, the plumb line drops through it,
 * the bob lands, the wordmark arrives, the footnote settles. 1180ms in total,
 * the same as the web.
 *
 * The one rule this obeys: animation may only fill waiting that already
 * exists. A cold start reads the stored session and loads three font families
 * before anything can render, so the sequence covers work rather than adding
 * to it, and it is never staged on top of a warm start.
 */
export function Splash({ onDone }: { onDone?: () => void }) {
  const { reduced, ms } = useMotion();
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

  const apertureProps = useAnimatedProps(() => ({ opacity: aperture.value }));
  const apertureStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.86 + aperture.value * 0.14 }],
  }));
  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: LINE_LENGTH * (1 - line.value),
  }));
  const bobStyle = useAnimatedStyle(() => ({ opacity: bob.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value,
    transform: [{ translateY: (1 - word.value) * 8 }],
  }));
  const footStyle = useAnimatedStyle(() => ({ opacity: foot.value * 0.9 }));

  return (
    <View style={styles.screen}>
      <View style={styles.centre}>
        <Animated.View style={apertureStyle}>
          <Svg width={64} height={64} viewBox="0 0 64 64">
            <AnimatedRect
              x={14}
              y={14}
              width={36}
              height={36}
              fill="none"
              stroke={colors.textOnDark}
              strokeWidth={3.55}
              animatedProps={apertureProps}
            />
            <AnimatedPath
              d="M32 4 V60"
              stroke={palette.indigo3}
              strokeWidth={3.55}
              strokeDasharray={LINE_LENGTH}
              animatedProps={lineProps}
            />
          </Svg>
          <Animated.View style={[styles.bob, bobStyle]}>
            <Svg width={64} height={16} viewBox="0 0 64 16">
              <Circle cx={32} cy={4} r={3.6} fill={palette.indigo3} />
            </Svg>
          </Animated.View>
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
  // The bob hangs below the aperture, on the same axis as the line.
  bob: { position: "absolute", top: 56, left: 0, right: 0, alignItems: "center" },
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
