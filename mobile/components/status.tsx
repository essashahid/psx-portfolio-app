import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, fontSize, space } from "@/lib/theme";

export function Loading() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.accentPrimary} />
    </View>
  );
}

/** Shown above content the user can still read, so a failed refresh is visible without blanking the screen. */
export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: space.xxl },
  error: { fontSize: fontSize.sm, color: colors.textDown, marginTop: space.md },
});
