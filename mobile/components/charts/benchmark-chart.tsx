import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedProps, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import * as Haptics from "expo-haptics";
import type { BenchmarkPoint } from "@psx/shared/api/performance";
import { formatCompact } from "@psx/shared/format";
import { ease, useMotion } from "@/lib/motion";
import { colors, fontFamily, fontSize, layout, palette, space } from "@/lib/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The three paths that answer "was holding these companies worth it".
 *
 * Your book, the same contributions put into the KSE-100 instead, and what
 * they would need to be worth to have merely kept their purchasing power. The
 * contributed line is the fourth: everything above it is gain, everything
 * below it is loss, which is the one reading that needs no arithmetic.
 */
const SERIES = [
  { key: "portfolio", label: "You", color: colors.accentPrimary, width: 2.25 },
  { key: "kse100", label: "KSE-100", color: palette.up2, width: 1.5 },
  { key: "inflation", label: "Inflation", color: palette.saffron2, width: 1.25 },
  { key: "contributed", label: "Put in", color: colors.textFaint, width: 1, dashed: true },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

export function BenchmarkChart({
  series,
  height = 200,
}: {
  series: BenchmarkPoint[];
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const geometry = useMemo(() => {
    if (series.length < 2 || width === 0) return null;

    const shown = SERIES.filter((s) => !hidden.has(s.key));
    // The scale spans every visible line, so hiding one re-scales the rest and
    // a small difference between two paths becomes readable.
    const values = series.flatMap((p) => shown.map((s) => p[s.key]));
    // The frame spans the data, not zero. Four lines that all start near a
    // million and diverge from there need the divergence to fill the frame;
    // anchoring at zero spends a third of the height on empty space and
    // flattens the thing the chart exists to show.
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const padY = 12;
    const padRight = 46;
    const plotW = Math.max(1, width - padRight);
    const plotH = height - padY * 2;

    const x = (i: number) => (i / (series.length - 1)) * plotW;
    const y = (v: number) => padY + (1 - (v - min) / span) * plotH;

    const paths = shown.map((s) => {
      const points = series.map((p, i) => ({ x: x(i), y: y(p[s.key]) }));
      // The draw-in masks the line with a dash as long as the line itself, so
      // the length has to be the real one. An estimate that falls short leaves
      // the tail of a jagged path sitting in the dash gap, permanently
      // invisible: the KSE-100 line used to disappear halfway across.
      let length = 0;
      for (let i = 1; i < points.length; i += 1) {
        length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      return {
        ...s,
        d: points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" "),
        length,
        last: points[points.length - 1],
        value: series[series.length - 1][s.key],
      };
    });

    return { paths, plotW, y, max, min, maxLength: Math.max(...paths.map((p) => p.length), 1) };
  }, [series, width, height, hidden]);

  const { reduced, ms } = useMotion();
  const draw = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    draw.value = 0;
    draw.value = ease(1, ms("draw"));
  }, [series.length, reduced, ms, draw]);

  // One offset for every line, scaled to the longest, so they finish together
  // rather than the short ones racing ahead.
  const longest = geometry?.maxLength ?? 1;
  const drawProps = useAnimatedProps(() => ({ strokeDashoffset: longest * (1 - draw.value) }));

  function toggle(key: SeriesKey) {
    void Haptics.selectionAsync();
    setHidden((prev) => {
      const next = new Set(prev);
      // Never hide the last visible line: an empty frame is not a view.
      if (next.has(key)) next.delete(key);
      else if (SERIES.length - next.size > 1) next.add(key);
      return next;
    });
  }

  return (
    <View>
      <View style={{ height }} onLayout={onLayout}>
        {geometry ? (
          <Svg width={width} height={height}>
            {geometry.paths.map((p) => (
              <AnimatedPath
                key={p.key}
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={p.width}
                strokeLinejoin="round"
                strokeDasharray={"dashed" in p && p.dashed ? "3 4" : longest}
                animatedProps={"dashed" in p && p.dashed ? undefined : drawProps}
              />
            ))}
            {geometry.paths.map((p) => (
              <Circle key={`${p.key}-dot`} cx={p.last.x} cy={p.last.y} r={2.5} fill={p.color} />
            ))}
            {/* Only the top and bottom line get a written value: four labels
                stacked at the right edge overlap into noise. */}
            {geometry.paths
              .slice()
              .sort((a, b) => a.last.y - b.last.y)
              .filter((_, i, all) => i === 0 || i === all.length - 1)
              .map((p) => (
                <SvgText
                  key={`${p.key}-label`}
                  x={geometry.plotW + 4}
                  y={p.last.y + 3.5}
                  fill={p.color}
                  fontSize={9}
                  fontFamily={fontFamily.monoMedium}
                >
                  {formatCompact(p.value)}
                </SvgText>
              ))}
            <Line
              x1={0}
              y1={height - 0.5}
              x2={geometry.plotW}
              y2={height - 0.5}
              stroke={colors.rule}
              strokeWidth={1}
            />
          </Svg>
        ) : (
          <View style={styles.blank}>
            <Text style={styles.blankText}>Not enough history to compare yet.</Text>
          </View>
        )}
      </View>

      <View style={styles.legend}>
        {SERIES.map((s) => {
          const on = !hidden.has(s.key);
          return (
            <Pressable
              key={s.key}
              onPress={() => toggle(s.key)}
              style={styles.legendItem}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${s.label}${on ? ", showing" : ", hidden"}`}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: on ? s.color : "transparent", borderColor: s.color },
                ]}
              />
              <Text style={[styles.legendLabel, !on && styles.legendLabelOff]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, alignItems: "center", justifyContent: "center" },
  blankText: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: colors.textFaint },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md, marginTop: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 32 },
  swatch: { width: 9, height: 9, borderRadius: 2, borderWidth: 1.5 },
  legendLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: colors.textStrong },
  legendLabelOff: { color: colors.textFaint },
});
