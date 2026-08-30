import { Pressable, StyleSheet, View, type ViewProps } from "react-native";
import { colors, layout, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

/** A section of the page: full-bleed rules, gutter-padded content. */
export function Band({ style, ...rest }: ViewProps) {
  const styles = useStyles();
  return <View {...rest} style={[styles.band, style]} />;
}

/**
 * A run of rows separated by hairlines. The separator lives on the row rather
 * than the container so a list can grow without the last rule dangling.
 */
export function Ledger({ style, ...rest }: ViewProps) {
  const styles = useStyles();
  return <View {...rest} style={[styles.ledger, style]} />;
}

/** One row of a ledger. Always clears the 44pt touch minimum. */
/**
 * A row in a ledger. Given an onPress it becomes a target instead of a plain
 * view: held, it sinks into the page and shows a leading edge in the row's own
 * hue. Background shifts rather than opacity, so a dense list of figures stays
 * readable while a thumb is on it.
 */
export function LedgerRow({
  style,
  onPress,
  edgeColor,
  ...rest
}: ViewProps & {
  onPress?: () => void;
  /** Usually the row's sector colour, from sectorColor(). */
  edgeColor?: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  if (!onPress) return <View {...rest} style={[styles.ledgerRow, style]} />;
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.ledgerRow,
        styles.ledgerRowInteractive,
        pressed && styles.ledgerRowPressed,
        pressed && { borderLeftColor: edgeColor ?? colors.accentPrimary },
        style,
      ]}
    />
  );
}

/** A hairline the width of the content column. */
export function Rule({ style, ...rest }: ViewProps) {
  const styles = useStyles();
  return <View {...rest} style={[styles.rule, style]} />;
}

const useStyles = makeStyles((c) => ({
  band: { paddingVertical: layout.bandPadY, paddingHorizontal: layout.gutter },
  ledger: { marginTop: space.xs },
  ledgerRowInteractive: { borderLeftWidth: 3, borderLeftColor: "transparent", paddingLeft: space.sm, marginLeft: -space.sm },
  ledgerRowPressed: { backgroundColor: c.surfaceSunken },
  ledgerRow: {
    minHeight: layout.hitMin,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
  },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: c.rule },
}));
