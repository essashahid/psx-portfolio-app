import { StyleSheet, Text, View } from "react-native";
import type { MarketDistribution } from "@psx/shared/api/market";
import { formatPctSigned } from "@psx/shared/format";
import { colors, fontFamily, fontSize, palette, space } from "@/lib/theme";

/**
 * Where every company landed today, and where yours landed in it.
 *
 * The distribution alone is a market statistic. Your own tickers marked inside
 * it is the point: it turns "I am down 2%" into "so is everything else" or
 * "everything else is up", which is the difference between a bad day and a bad
 * decision.
 */
export function ReturnHistogram({ distribution }: { distribution: MarketDistribution }) {
  const { buckets, best, worst } = distribution;
  const max = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <View>
      <View style={styles.bars}>
        {buckets.map((bucket) => {
          const tone =
            bucket.hi <= 0 ? palette.down2 : bucket.lo >= 0 ? palette.up2 : colors.textFaint;
          return (
            <View key={bucket.lo} style={styles.column}>
              <Text style={styles.count}>{bucket.count || ""}</Text>
              <View
                style={[
                  styles.bar,
                  {
                    // A bucket with companies in it always paints at least a
                    // hairline, so a thin tail is visible rather than absent.
                    height: bucket.count === 0 ? 0 : Math.max(2, (bucket.count / max) * 96),
                    backgroundColor: tone,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.axis}>
        {buckets.map((bucket) => (
          <View key={bucket.lo} style={styles.column}>
            {/* Every other label: twelve numbers across a phone is a smear. */}
            <Text style={styles.tick}>{bucket.lo % 2 === 0 ? bucket.lo : ""}</Text>
          </View>
        ))}
      </View>

      <View style={styles.marks}>
        {buckets.map((bucket) => (
          <View key={bucket.lo} style={styles.column}>
            {bucket.mine.length > 0 ? (
              <>
                <View style={styles.stem} />
                {/* Three lines: two tickers plus the overflow count. Two cut
                    the second ticker mid-word. */}
                <Text style={styles.mine} numberOfLines={3}>
                  {bucket.mine.slice(0, 2).join("\n")}
                  {bucket.mine.length > 2 ? `\n+${bucket.mine.length - 2}` : ""}
                </Text>
              </>
            ) : null}
          </View>
        ))}
      </View>

      {best && worst ? (
        <View style={styles.extremes}>
          <Text style={styles.weak}>
            {worst.ticker} {formatPctSigned(worst.pct)}
          </Text>
          <Text style={styles.strong}>
            {best.ticker} {formatPctSigned(best.pct)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 118 },
  column: { flex: 1, alignItems: "center" },
  count: {
    fontFamily: fontFamily.monoSemibold,
    fontSize: 9,
    color: colors.textMuted,
    marginBottom: 2,
  },
  bar: { width: "100%" },
  axis: {
    flexDirection: "row",
    gap: 3,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ruleStrong,
  },
  tick: { fontFamily: fontFamily.mono, fontSize: 9, color: colors.textFaint },
  marks: { flexDirection: "row", gap: 3, marginTop: space.sm, minHeight: 34 },
  stem: { width: 1.5, height: 7, backgroundColor: colors.accentPrimary },
  mine: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: 8,
    lineHeight: 10,
    textAlign: "center",
    color: colors.accentPrimary,
    marginTop: 2,
  },
  extremes: { flexDirection: "row", justifyContent: "space-between", marginTop: space.md },
  weak: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.xxs, color: colors.textDown },
  strong: { fontFamily: fontFamily.monoSemibold, fontSize: fontSize.xxs, color: colors.textUp },
});
