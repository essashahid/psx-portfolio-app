import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, fontFamily, fontSize, layout, palette, space } from "@/lib/theme";
import { makeStyles, useColors } from "@/lib/theme-context";

type Props = Omit<PressableProps, "style"> & {
  label: string;
  busy?: boolean;
  /** Sits on the ink field rather than on paper. */
  onDark?: boolean;
};

/** The primary action: a solid pill. */
export function Cta({ label, busy, onDark, disabled, onPress, ...rest }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const inert = disabled || busy;
  return (
    <Pressable
      {...rest}
      disabled={inert}
      onPress={(event) => {
        void Haptics.selectionAsync();
        onPress?.(event);
      }}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.cta,
        onDark && styles.ctaOnDark,
        inert && styles.inert,
        pressed && !inert && (onDark ? styles.ctaPressedOnDark : styles.ctaPressed),
      ]}
    >
      {busy ? (
        <ActivityIndicator color={onDark ? colors.textStrong : colors.textOnDark} />
      ) : (
        <Text style={[styles.ctaLabel, onDark && styles.ctaLabelOnDark]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** The secondary action: outlined, same height. */
export function Ghost({ label, busy, onDark, disabled, onPress, ...rest }: Props) {
  const styles = useStyles();
  const inert = disabled || busy;
  return (
    <Pressable
      {...rest}
      disabled={inert}
      onPress={(event) => {
        void Haptics.selectionAsync();
        onPress?.(event);
      }}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.ghost,
        onDark && styles.ghostOnDark,
        inert && styles.inert,
        pressed && !inert && (onDark ? styles.ghostPressedOnDark : styles.ghostPressed),
      ]}
    >
      <Text style={[styles.ghostLabel, onDark && styles.ghostLabelOnDark]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  cta: {
    minHeight: 48,
    borderRadius: layout.radiusPill,
    backgroundColor: c.ink,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
  },
  ctaOnDark: { backgroundColor: c.surfacePage },
  ctaLabel: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: fontSize.body,
    color: c.textOnDark,
  },
  ctaLabelOnDark: { color: c.textStrong },
  ghost: {
    minHeight: 48,
    borderRadius: layout.radiusPill,
    borderWidth: 1,
    borderColor: c.ruleStrong,
    backgroundColor: c.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
  },
  ghostOnDark: { backgroundColor: "transparent", borderColor: "rgba(255,255,255,0.22)" },
  ghostLabel: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: fontSize.sm,
    color: c.textStrong,
  },
  ghostLabelOnDark: { fontSize: fontSize.body, color: c.textOnDark },
  inert: { opacity: 0.4 },
  /**
   * Press confirms in a background shift, never in opacity and never in
   * scale. A financial control that springs under a thumb reads as a toy, and
   * a fading one reads as broken.
   */
  ctaPressed: { backgroundColor: palette.indigo1 },
  ctaPressedOnDark: { backgroundColor: palette.paper3 },
  ghostPressed: { backgroundColor: c.surfaceInset, borderColor: c.ink },
  ghostPressedOnDark: { backgroundColor: "rgba(255,255,255,0.14)" },
}));
