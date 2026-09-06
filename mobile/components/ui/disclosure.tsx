import { useState } from "react";
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { ChevronDown } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { ease, useMotion } from "@/lib/motion";
import { fontFamily, fontSize, layout, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

// The old architecture needs this flag before LayoutAnimation does anything on
// Android. It is a no-op on the new one, so calling it costs nothing.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Progressive disclosure: a tappable row that expands in place.
 *
 * This is how a phone keeps a screen short without hiding data. The row reads
 * as a sentence of what is behind it ("All ratios", "Show all eight"), and an
 * optional note carries the count or the period so a reader knows whether it
 * is worth opening. The content stays mounted only while open, so a long
 * ledger behind a closed row costs nothing to scroll past.
 */
export function Disclosure({
  label,
  openLabel,
  note,
  defaultOpen = false,
  children,
  style,
  nested = false,
}: {
  label: string;
  /** What the row says once open. Defaults to the closed label. */
  openLabel?: string;
  note?: string | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Indented and lighter, for a disclosure inside another. */
  nested?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { ms, reduced } = useMotion();
  const [open, setOpen] = useState(defaultOpen);
  const turn = useSharedValue(defaultOpen ? 1 : 0);

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 180}deg` }],
  }));

  function toggle() {
    void Haptics.selectionAsync();
    if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(220, "easeInEaseOut", "opacity"));
    const next = !open;
    turn.value = ease(next ? 1 : 0, ms("base"));
    setOpen(next);
  }

  return (
    <View style={[styles.wrap, nested && styles.wrapNested, style]}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Text style={[styles.label, nested && styles.labelNested]}>{open ? openLabel ?? label : label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
        <Animated.View style={chevron}>
          <ChevronDown size={16} color={colors.textMuted} />
        </Animated.View>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.ruleStrong,
  },
  wrapNested: { borderTopColor: c.rule, marginTop: space.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: layout.hitMin,
    paddingVertical: space.sm,
  },
  rowPressed: { backgroundColor: c.surfaceSunken },
  label: { flex: 1, fontFamily: fontFamily.uiSemibold, fontSize: fontSize.sm, color: c.textStrong },
  labelNested: { fontFamily: fontFamily.uiMedium, color: c.textMuted },
  note: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: c.textFaint },
  body: { paddingBottom: space.md },
}));
