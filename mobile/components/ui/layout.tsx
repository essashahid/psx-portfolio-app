import { StyleSheet, View, type ViewProps } from "react-native";
import { colors, layout, space } from "@/lib/theme";

/** A section of the page: full-bleed rules, gutter-padded content. */
export function Band({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.band, style]} />;
}

/**
 * A run of rows separated by hairlines. The separator lives on the row rather
 * than the container so a list can grow without the last rule dangling.
 */
export function Ledger({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.ledger, style]} />;
}

/** One row of a ledger. Always clears the 44pt touch minimum. */
export function LedgerRow({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.ledgerRow, style]} />;
}

/** A hairline the width of the content column. */
export function Rule({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.rule, style]} />;
}

const styles = StyleSheet.create({
  band: { paddingVertical: layout.bandPadY, paddingHorizontal: layout.gutter },
  ledger: { marginTop: space.xs },
  ledgerRow: {
    minHeight: layout.hitMin,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
  },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.rule },
});
