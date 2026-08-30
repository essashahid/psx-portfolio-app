import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedProps, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";
import * as Haptics from "expo-haptics";
import type { ChartCandle, ChartTrade } from "@psx/shared/api/chart";
import { formatNumber } from "@psx/shared/format";
import { ease, useMotion } from "@/lib/motion";
import { Shimmer } from "@/components/ui/motion";
import { colors, fontFamily, fontSize, layout, palette, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

const AnimatedPath = Animated.createAnimatedComponent(Path);

export const CHART_PERIODS = ["1M", "3M", "6M", "1Y", "5Y"] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

/**
 * The price track for one company.
 *
 * Two things make this worth more than a generic chart: the dashed rule is
 * your own average cost, so the whole picture reads as above or below water at
 * a glance, and the marks on the line are your trades. Without those it is a
 * chart you could get anywhere.
 */
export function PriceChart({
  candles,
  avgCost,
  trades,
  height = 180,
  loading,
}: {
  candles: ChartCandle[];
  avgCost: number | null;
  trades: ChartTrade[];
  height?: number;
  loading?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const geometry = useMemo(() => {
    if (candles.length < 2 || width === 0) return null;

    const closes = candles.map((c) => c.close);
    const candidates = avgCost !== null && avgCost > 0 ? [...closes, avgCost] : closes;
    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    const span = max - min || 1;
    const padY = 10;
    // Room on the right for the price scale, so the last point is not written
    // over by its own label.
    const padRight = 44;
    const plotW = Math.max(1, width - padRight);
    const plotH = height - padY * 2;

    const x = (i: number) => (i / (candles.length - 1)) * plotW;
    const y = (v: number) => padY + (1 - (v - min) / span) * plotH;

    const line = closes.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    const area = `${line} L${plotW.toFixed(1)} ${height} L0 ${height} Z`;

    // Trades land on the nearest session the chart actually has, so a weekend
    // or a holiday does not drop the mark off the line entirely.
    const dates = candles.map((c) => c.date);
    const marks = trades
      .map((trade) => {
        let index = dates.findIndex((d) => d >= trade.date);
        if (index === -1) index = dates.length - 1;
        return { trade, cx: x(index), cy: y(closes[index]) };
      })
      .filter((m) => Number.isFinite(m.cx) && Number.isFinite(m.cy));

    // The real length, not an estimate: the draw-in masks the line with a dash
    // as long as the line, and a short estimate leaves the tail of a jagged
    // path stuck in the gap where it never appears.
    let length = 0;
    for (let i = 1; i < closes.length; i += 1) {
      length += Math.hypot(x(i) - x(i - 1), y(closes[i]) - y(closes[i - 1]));
    }

    return {
      line,
      area,
      x,
      y,
      min,
      max,
      plotW,
      marks,
      length,
      last: { x: x(closes.length - 1), y: y(closes[closes.length - 1]) },
    };
  }, [candles, avgCost, trades, width, height]);

  const { reduced, ms } = useMotion();
  const draw = useSharedValue(reduced ? 1 : 0);
  const dashLength = geometry?.length ?? 1;

  useEffect(() => {
    if (reduced || !geometry) return;
    draw.value = 0;
    draw.value = ease(1, ms("draw"));
  }, [geometry?.line, reduced, ms, draw, geometry]);

  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: dashLength * (1 - draw.value) }));

  if (loading) {
    return (
      <View style={{ height }} onLayout={onLayout}>
        <Shimmer height={height} />
      </View>
    );
  }

  if (!geometry) {
    return (
      <View style={[styles.blank, { height }]} onLayout={onLayout}>
        <Text style={styles.blankText}>No price history for this period.</Text>
      </View>
    );
  }

  const up = candles[candles.length - 1].close >= candles[0].close;
  const stroke = up ? palette.up2 : palette.down2;

  return (
    <View style={{ height }} onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={stroke} stopOpacity={0.16} />
            <Stop offset="100%" stopColor={stroke} stopOpacity={0.01} />
          </LinearGradient>
        </Defs>

        <Path d={geometry.area} fill="url(#priceFill)" />
        <AnimatedPath
          d={geometry.line}
          fill="none"
          stroke={stroke}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeDasharray={dashLength}
          animatedProps={lineProps}
        />

        {/* Your cost, so above and below water is readable without arithmetic. */}
        {avgCost !== null && avgCost > 0 ? (
          <>
            <Line
              x1={0}
              y1={geometry.y(avgCost)}
              x2={geometry.plotW}
              y2={geometry.y(avgCost)}
              stroke={colors.textFaint}
              strokeDasharray="3 4"
              strokeWidth={1}
            />
            <SvgText
              x={geometry.plotW + 4}
              y={geometry.y(avgCost) + 3.5}
              fill={colors.textFaint}
              fontSize={9}
              fontFamily={fontFamily.mono}
            >
              {formatNumber(avgCost, 0)}
            </SvgText>
          </>
        ) : null}

        {geometry.marks.map((mark, i) => (
          <Circle
            key={`${mark.trade.date}-${i}`}
            cx={mark.cx}
            cy={mark.cy}
            r={3}
            fill={colors.surfacePage}
            stroke={mark.trade.type === "SELL" ? palette.down2 : colors.ink}
            strokeWidth={1.5}
          />
        ))}

        <Circle cx={geometry.last.x} cy={geometry.last.y} r={3} fill={stroke} />
        <SvgText
          x={geometry.plotW + 4}
          y={geometry.last.y + 3.5}
          fill={colors.textStrong}
          fontSize={9}
          fontFamily={fontFamily.monoSemibold}
        >
          {formatNumber(candles[candles.length - 1].close, 0)}
        </SvgText>
      </Svg>
    </View>
  );
}

/** The period rail under a price chart. */
export function PeriodRail({
  value,
  onChange,
}: {
  value: ChartPeriod;
  onChange: (next: ChartPeriod) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.rail}>
      {CHART_PERIODS.map((period) => {
        const on = period === value;
        return (
          <Pressable
            key={period}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(period);
            }}
            style={[styles.period, on && styles.periodOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.periodLabel, on && styles.periodLabelOn]}>{period}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  blank: { alignItems: "center", justifyContent: "center" },
  blankText: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: c.textFaint },
  rail: { flexDirection: "row", gap: space.xs, marginTop: space.md },
  period: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: layout.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.rule,
  },
  periodOn: { backgroundColor: c.ink, borderColor: c.ink },
  periodLabel: { fontFamily: fontFamily.monoMedium, fontSize: fontSize.xxs, color: c.textMuted },
  periodLabelOn: { color: c.textOnDark },
}));
