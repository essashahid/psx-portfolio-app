import { StyleSheet, Text, View } from "react-native";
import { fontSize, letterSpacing, space, tracking } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-context";

/** A section label and optional right-hand note, over a hairline rule. */
export function SectionHeader({ title, note }: { title: string; note?: string | null }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.rule,
    gap: space.sm,
  },
  title: {
    fontSize: fontSize.xxs,
    color: c.textMuted,
    letterSpacing: letterSpacing(fontSize.xxs, tracking.caps),
  },
  note: { fontSize: fontSize.xs, color: c.textFaint, flexShrink: 1, textAlign: "right" },
}));
