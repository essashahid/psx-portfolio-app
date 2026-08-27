import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, fontSize, layout, space } from "@/lib/theme";

/** Switches between views of the same subject. Text only, no icons. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.track}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => {
              if (option === value) return;
              void Haptics.selectionAsync();
              onChange(option);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSunken,
    borderRadius: layout.radiusSm,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: layout.radiusSm - 3,
    paddingHorizontal: space.sm,
  },
  segmentActive: { backgroundColor: colors.surfaceRaised },
  label: { fontSize: fontSize.sm, color: colors.textMuted },
  labelActive: { color: colors.textStrong, fontWeight: "600" },
});
