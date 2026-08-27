import { useEffect, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedProps, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { ease, useMotion } from "@/lib/motion";
import { palette } from "@/lib/theme";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The value curve on the home header: a filled area, a dashed cost line, and a
 * dot on the last point.
 *
 * It measures its own width rather than taking a viewBox and stretching, so the
 * stroke stays one weight and the curve keeps its proportions on any screen.
 *
 * The line draws itself in left to right and the fill follows it, which is the
 * one place a chart is allowed to animate: it says "this is a series read in
 * time order" before a single figure has been read.
 */
export function AreaChart({
  values,
  /** Draws the dashed horizontal reference, typically total cost. */
  reference,
  height = 96,
  color = palette.indigo3,
}: {
  values: number[];
  reference?: number | null;
  height?: number;
  color?: string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  if (values.length < 2 || width === 0) {
    return <View style={{ height }} onLayout={onLayout} />;
  }

  // Include the reference in the extent, otherwise a cost line above the curve
  // is drawn off the top of the frame.
  const candidates = reference === null || reference === undefined ? values : [...values, reference];
  const min = Math.min(...candidates);
  const max = Math.max(...candidates);
  const span = max - min || 1;
  // A little headroom top and bottom so the line never touches the edge.
  const pad = 4;
  const plot = height - pad * 2;

  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (value: number) => pad + (1 - (value - min) / span) * plot;

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${width.toFixed(1)} ${height} L0 ${height} Z`;
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]);

  return (
    <ChartBody
      width={width}
      height={height}
      color={color}
      line={line}
      area={area}
      lastX={lastX}
      lastY={lastY}
      referenceY={reference === null || reference === undefined ? null : y(reference)}
      onLayout={onLayout}
    />
  );
}

function ChartBody({
  width,
  height,
  color,
  line,
  area,
  lastX,
  lastY,
  referenceY,
  onLayout,
}: {
  width: number;
  height: number;
  color: string;
  line: string;
  area: string;
  lastX: number;
  lastY: number;
  referenceY: number | null;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { reduced, ms } = useMotion();
  const draw = useSharedValue(reduced ? 1 : 0);
  const fill = useSharedValue(reduced ? 1 : 0);
  const dot = useSharedValue(reduced ? 1 : 0);

  // A generous over-estimate of the real path length. The dash only has to be
  // longer than the path for the mask to clear it completely, and react-native-svg
  // gives no way to measure a path off the main thread.
  const pathLength = (width + height) * 3;

  useEffect(() => {
    if (reduced) return;
    draw.value = ease(1, ms("draw"));
    fill.value = ease(1, ms("base"), 260);
    dot.value = ease(1, 200, 620);
    // Redrawn whenever the series itself changes, not on every re-render.
  }, [line, reduced, ms, draw, fill, dot]);

  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: pathLength * (1 - draw.value),
  }));
  const areaProps = useAnimatedProps(() => ({ opacity: fill.value }));
  const dotProps = useAnimatedProps(() => ({ opacity: dot.value }));

  return (
    <View style={{ height }} onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={color} stopOpacity={0.34} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <AnimatedPath d={area} fill="url(#areaFill)" animatedProps={areaProps} />
        <AnimatedPath
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeDasharray={pathLength}
          animatedProps={lineProps}
        />
        {referenceY !== null ? (
          <Line
            x1={0}
            y1={referenceY}
            x2={width}
            y2={referenceY}
            stroke="rgba(255,255,255,0.28)"
            strokeDasharray="3 4"
            strokeWidth={1}
          />
        ) : null}
        <AnimatedCircle cx={lastX} cy={lastY} r={3.5} fill={color} animatedProps={dotProps} />
      </Svg>
    </View>
  );
}

export const chartStyles = StyleSheet.create({ fill: { width: "100%" } });
