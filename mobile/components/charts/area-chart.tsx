import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { palette } from "@/lib/theme";

/**
 * The value curve on the home header: a filled area, a dashed cost line, and a
 * dot on the last point.
 *
 * It measures its own width rather than taking a viewBox and stretching, so the
 * stroke stays one weight and the curve keeps its proportions on any screen.
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
    <View style={{ height }} onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={color} stopOpacity={0.34} />
            <Stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </LinearGradient>
        </Defs>
        <Path d={area} fill="url(#areaFill)" />
        <Path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {reference !== null && reference !== undefined ? (
          <Line
            x1={0}
            y1={y(reference)}
            x2={width}
            y2={y(reference)}
            stroke="rgba(255,255,255,0.28)"
            strokeDasharray="3 4"
            strokeWidth={1}
          />
        ) : null}
        <Circle cx={lastX} cy={lastY} r={3.5} fill={color} />
      </Svg>
    </View>
  );
}

export const chartStyles = StyleSheet.create({ fill: { width: "100%" } });
