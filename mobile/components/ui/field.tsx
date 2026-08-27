import { forwardRef } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Caps } from "@/components/ui/text";
import { colors, fontFamily, fontSize, layout, letterSpacing, space, tracking } from "@/lib/theme";

/**
 * The form primitives. Every input in the app comes from here so a label, a
 * validation message and a touch target look the same wherever they appear.
 *
 * Inputs are 16px because anything smaller makes iOS zoom the viewport on
 * focus, and they clear the 44pt minimum because a mistyped figure in a ledger
 * is worse than a slow one.
 */

export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string | null; hint?: string }>(
  function Field({ label, error, hint, style, ...rest }, ref) {
    return (
      <View style={styles.field}>
        <Caps>{label}</Caps>
        <TextInput
          ref={ref}
          {...rest}
          style={[styles.input, error ? styles.inputError : null, style]}
          placeholderTextColor={colors.textFaint}
        />
        {/* The error replaces the hint rather than stacking, so the row never
            changes height and the form does not jump as you type. */}
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : hint ? (
          <Text style={styles.hint}>{hint}</Text>
        ) : null}
      </View>
    );
  }
);

/** A small set of mutually exclusive choices, laid out as a row of pills. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  labelFor,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Renders a readable name for an option whose stored value is a code. */
  labelFor?: (option: T) => string;
}) {
  return (
    <View style={styles.field}>
      <Caps>{label}</Caps>
      <View style={styles.choices}>
        {options.map((option) => {
          const on = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => {
                void Haptics.selectionAsync();
                onChange(option);
              }}
              style={[styles.choice, on && styles.choiceOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.choiceLabel, on && styles.choiceLabelOn]}>{labelFor ? labelFor(option) : option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.lg,
    minHeight: layout.hitMin,
    paddingVertical: space.sm,
  },
  togglePressed: { backgroundColor: colors.surfaceSunken },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontFamily: fontFamily.ui, fontSize: fontSize.body, color: colors.textStrong },
  toggleDim: { color: colors.textFaint },
  toggleHint: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, lineHeight: 17, color: colors.textFaint },
  track: {
    width: 46,
    height: 28,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.surfaceInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
    padding: 3,
    justifyContent: "center",
  },
  trackOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  knob: { width: 20, height: 20, borderRadius: layout.radiusPill, backgroundColor: colors.surfaceRaised },
  knobOn: { alignSelf: "flex-end" },

  field: { gap: space.sm - 2 },
  input: {
    minHeight: layout.hitMin,
    borderWidth: 1,
    borderColor: colors.rule,
    borderRadius: layout.radiusSm,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.md,
    // 16px stops iOS zooming the viewport on focus.
    fontSize: 16,
    fontFamily: fontFamily.ui,
    color: colors.textStrong,
  },
  inputError: { borderColor: colors.statusDanger },
  error: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textDown },
  hint: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, color: colors.textFaint },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  choice: {
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderColor: colors.ruleStrong,
    borderRadius: layout.radiusPill,
  },
  // Selection inverts rather than tinting: a tint would compete with the
  // directional colours, which have to stay unambiguous.
  choiceOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  choiceLabel: {
    fontFamily: fontFamily.uiMedium,
    fontSize: fontSize.sm,
    letterSpacing: letterSpacing(fontSize.sm, tracking.ui),
    color: colors.textMuted,
  },
  choiceLabelOn: { color: colors.textOnDark },
});

/**
 * A setting that is on or off.
 *
 * The row is the target rather than a small track on the right, because a
 * 32-pixel switch beside a full-width label is a miss waiting to happen. The
 * track still carries the state, so it reads the way a switch should.
 */
export function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        void Haptics.selectionAsync();
        onChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.toggleRow, pressed && !disabled && styles.togglePressed]}
    >
      <View style={styles.toggleText}>
        <Text style={[styles.toggleLabel, disabled && styles.toggleDim]}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}
