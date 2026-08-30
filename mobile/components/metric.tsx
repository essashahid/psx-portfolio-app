import { StyleSheet, Text, View } from "react-native";
import { colors, fontSize, letterSpacing, space, tracking } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

/**
 * The web app's Metric-grid pattern: a label above a figure, laid out in a
 * grid with hairline rules and no nested cards. Colour is reserved for
 * direction, never decoration.
 */
export function Metric({
  label,
  value,
  tone = "neutral",
  size = "normal",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "up" | "down";
  size?: "normal" | "large";
}) {
  const styles = useStyles();
  const colors = useColors();
  const toneColor =
    tone === "up" ? colors.textUp : tone === "down" ? colors.textDown : colors.textStrong;

  return (
    <View style={styles.metric}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <Text
        style={[
          size === "large" ? styles.valueLarge : styles.value,
          { color: toneColor },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

export function MetricGrid({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <View style={styles.grid}>{children}</View>;
}

const useStyles = makeStyles((c) => ({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.rule,
  },
  metric: {
    flexBasis: "50%",
    flexGrow: 1,
    paddingVertical: space.md,
    paddingRight: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
    gap: space.xs,
  },
  label: {
    fontSize: fontSize.xxs,
    color: c.textMuted,
    letterSpacing: letterSpacing(fontSize.xxs, tracking.caps),
  },
  value: {
    fontSize: fontSize.h1,
    letterSpacing: letterSpacing(fontSize.h1, tracking.tight),
  },
  valueLarge: {
    fontSize: fontSize.title,
    letterSpacing: letterSpacing(fontSize.title, tracking.editorial),
  },
}));
