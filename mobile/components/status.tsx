import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, fontSize, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

export function Loading() {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accentPrimary} />
    </View>
  );
}

/** Shown above content the user can still read, so a failed refresh is visible without blanking the screen. */
export function ErrorNote({ message }: { message: string | null }) {
  const styles = useStyles();
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const useStyles = makeStyles((c) => ({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: space.xxl },
  error: { fontSize: fontSize.sm, color: c.textDown, marginTop: space.md },
}));
