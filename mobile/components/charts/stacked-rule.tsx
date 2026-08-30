import { StyleSheet, View } from "react-native";
import { makeStyles } from "@/lib/theme-context";

/**
 * Allocation as a single 12px rule rather than a donut.
 *
 * A donut on a phone spends a third of the screen to encode what a stacked rule
 * encodes in twelve pixels, and the ledger underneath carries the labels far
 * better than leader lines would.
 */
export function StackedRule({
  segments,
  height = 12,
}: {
  segments: { value: number; color: string }[];
  height?: number;
}) {
  const styles = useStyles();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  return (
    <View style={[styles.track, { height }]}>
      {segments.map((segment, i) => (
        <View
          key={i}
          style={{
            flex: segment.value,
            // A sliver still has to be visible, or a small sector vanishes.
            minWidth: 2,
            backgroundColor: segment.color,
          }}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  track: { flexDirection: "row", gap: 1, overflow: "hidden" },
}));
