import { StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check, ChevronDown } from "lucide-react-native";
import {
  groupedModels,
  providerReady,
  type ChatModelId,
  type ProviderStatus,
} from "@psx/shared/ai/models";
import { Sheet } from "@/components/ui/sheet";
import { colors, fontFamily, fontSize, layout, space } from "@/lib/theme";
import { Pressable } from "react-native";

/**
 * Choosing which model answers.
 *
 * The list is the same registry the web picker reads, so a model added there
 * appears here without a second edit. A provider the account cannot use is
 * shown rather than hidden, with the reason: a Copilot that silently offers
 * fewer choices on the phone than on the laptop looks broken, and "no key
 * configured" is a different problem from "not allowed".
 */
export function ModelChip({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      hitSlop={10}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}. Change it.`}
    >
      <Text style={styles.chipLabel}>{label}</Text>
      <ChevronDown size={13} color={colors.textMuted} />
    </Pressable>
  );
}

export function ModelPicker({
  open,
  value,
  providers,
  onClose,
  onChange,
}: {
  open: boolean;
  value: ChatModelId;
  providers: ProviderStatus | null;
  onClose: () => void;
  onChange: (next: ChatModelId) => void;
}) {
  return (
    <Sheet open={open} title="Which model answers" onClose={onClose}>
      {groupedModels().map((group) => (
        <View key={group.group} style={styles.group}>
          <Text style={styles.groupHead}>{group.group}</Text>
          {group.models.map((model) => {
            const ready = providers ? providerReady(providers, model.provider) : false;
            const on = model.id === value;
            const reason = !providers
              ? "checking"
              : !providers[model.provider]?.configured
                ? "no key configured"
                : !providers[model.provider]?.allowed
                  ? "not enabled on your account"
                  : null;
            return (
              <Pressable
                key={model.id}
                disabled={!ready}
                onPress={() => {
                  void Haptics.selectionAsync();
                  onChange(model.id);
                  onClose();
                }}
                style={({ pressed }) => [styles.row, pressed && ready && styles.rowPressed]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: !ready }}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.label, !ready && styles.dim]}>{model.label}</Text>
                  <Text style={styles.hint}>{ready ? model.hint : reason}</Text>
                </View>
                {on ? <Check size={17} color={colors.textStrong} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: layout.radiusPill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rule,
  },
  chipPressed: { backgroundColor: colors.surfaceSunken },
  chipLabel: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.xxs, color: colors.textMuted },
  group: { gap: space.xs },
  groupHead: {
    fontFamily: fontFamily.uiBold,
    fontSize: fontSize.xxxs,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: colors.textFaint,
    marginBottom: space.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: layout.hitMin,
    paddingVertical: space.sm,
  },
  rowPressed: { backgroundColor: colors.surfaceSunken },
  rowText: { flex: 1, gap: 1 },
  label: { fontFamily: fontFamily.uiMedium, fontSize: fontSize.body, color: colors.textStrong },
  dim: { color: colors.textFaint },
  hint: { fontFamily: fontFamily.ui, fontSize: fontSize.xxs, lineHeight: 17, color: colors.textFaint },
});
