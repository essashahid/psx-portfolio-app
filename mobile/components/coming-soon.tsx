import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fontSize, layout, letterSpacing, space, tracking } from "@/lib/theme";

/**
 * Placeholder for a tab whose screens have not been built yet. It names what is
 * coming rather than showing an empty page, so the skeleton is legible while
 * the milestones land.
 */
export function ComingSoon({ title, detail }: { title: string; detail: string }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.body}>
        <Text style={styles.eyebrow}>{title.toUpperCase()}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surfacePage },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: layout.gutter,
    gap: space.sm,
  },
  eyebrow: {
    fontSize: fontSize.xxs,
    color: colors.textMuted,
    letterSpacing: letterSpacing(fontSize.xxs, tracking.eyebrow),
  },
  detail: { fontSize: fontSize.body, color: colors.textBody, lineHeight: 22 },
});
