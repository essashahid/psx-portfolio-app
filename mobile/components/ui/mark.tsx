import Svg, { Circle, Path, Rect } from "react-native-svg";
import { StyleSheet, Text, View } from "react-native";
import { fontFamily, fontSize, letterSpacing, palette, space, tracking } from "@/lib/theme";
import { APP_NAME } from "@/lib/brand";
import { makeStyles } from "@/lib/theme-context";

/**
 * The mark: a square with a plumb line dropping through it and a bob below.
 * Redrawn from the handoff SVG rather than shipped as an asset, so it inherits
 * colour and scales without a raster.
 */
export function Mark({ size = 19 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect x={14} y={14} width={36} height={36} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={3.55} />
      <Path d="M32 4 V60" stroke={palette.indigo3} strokeWidth={3.55} />
      <Circle cx={32} cy={60} r={3.6} fill={palette.indigo3} />
    </Svg>
  );
}

/** Mark plus wordmark, as it appears in the header and on the login screen. */
export function Wordmark({ size = 19, textSize = fontSize.h3 }: { size?: number; textSize?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Mark size={size} />
      <Text style={[styles.word, { fontSize: textSize, letterSpacing: letterSpacing(textSize, tracking.editorial) }]}>
        {APP_NAME}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm + 1 },
  word: { fontFamily: fontFamily.display, color: c.textOnDark },
}));
