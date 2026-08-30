import { StyleSheet, View } from "react-native";
import { palette } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-context";

/**
 * A move measured from a centre line: right for a gain, left for a loss.
 *
 * Ranked rows with signed bars replace the desktop's sector tiles. A tile grid
 * makes you compare areas across two axes; a common baseline makes the ranking
 * readable in one pass down the page.
 */
export function SignedBar({
  value,
  /** The largest absolute move in the set, so bars are comparable. */
  extent,
  height = 14,
}: {
  value: number | null;
  extent: number;
  height?: number;
}) {
  const styles = useStyles();
  const magnitude = extent > 0 ? Math.min(1, Math.abs(value ?? 0) / extent) : 0;
  const positive = (value ?? 0) >= 0;

  return (
    <View style={[styles.track, { height }]}>
      <View style={styles.centre} />
      <View
        style={[
          styles.bar,
          positive
            ? { left: "50%", width: `${magnitude * 50}%`, backgroundColor: palette.up2 }
            : { right: "50%", width: `${magnitude * 50}%`, backgroundColor: palette.down2 },
        ]}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  track: { position: "relative", justifyContent: "center" },
  centre: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: 1,
    backgroundColor: c.ruleStrong,
  },
  bar: { position: "absolute", top: 4, height: 6 },
}));
