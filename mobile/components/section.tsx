import { StyleSheet, Text, View } from "react-native";
import { colors, fontSize, letterSpacing, space, tracking } from "@/lib/theme";

/** A section label and optional right-hand note, over a hairline rule. */
export function SectionHeader({ title, note }: { title: string; note?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.rule,
    gap: space.sm,
  },
  title: {
    fontSize: fontSize.xxs,
    color: colors.textMuted,
    letterSpacing: letterSpacing(fontSize.xxs, tracking.caps),
  },
  note: { fontSize: fontSize.xs, color: colors.textFaint, flexShrink: 1, textAlign: "right" },
});
