import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { fontSize, layout, space } from "@/lib/theme";
import { makeStyles } from "@/lib/theme-context";

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
  const styles = useStyles();
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

const useStyles = makeStyles((c) => ({
  track: {
    flexDirection: "row",
    backgroundColor: c.surfaceSunken,
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
  segmentActive: { backgroundColor: c.surfaceRaised },
  label: { fontSize: fontSize.sm, color: c.textMuted },
  labelActive: { color: c.textStrong, fontWeight: "600" },
}));
