import { useEffect } from "react";
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { PageTitle } from "@/components/ui/text";
import { colors, fontFamily, fontSize, layout, space } from "@/lib/theme";

/**
 * A bottom sheet for a single task: add a transaction, record a payout, edit a
 * position.
 *
 * A Modal rather than a pushed route because these are interruptions, not
 * destinations — you come back to where you were, and the URL should not
 * change. Dismissal is deliberately available three ways (the close control,
 * the scrim, the hardware back button) since a form with only one way out feels
 * like a trap on a phone.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // With the keyboard up, the panel sits on the keyboard rather than on the
  // navigation bar, so the bottom safe-area inset would leave a strip of the
  // screen behind showing through under the sheet.
  const keyboardVisible = useKeyboardState((state) => state.isVisible);

  // Android's back button must close the sheet, not the screen behind it.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        {/* The scrim closes the sheet, but only the part above it — a tap
            inside the panel must not dismiss a half-filled form. */}
        <Pressable style={styles.scrimTap} onPress={onClose} accessibilityLabel="Close" />
        {/* This KeyboardAvoidingView reads the keyboard natively, so it works
            inside a Modal where the React Native one does not. */}
        <KeyboardAvoidingView behavior="padding">
          <SafeAreaView edges={keyboardVisible ? [] : ["bottom"]} style={styles.panel}>
            <View style={styles.grip} />
            <View style={styles.head}>
              <PageTitle>{title}</PageTitle>
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" accessibilityRole="button">
                <X size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/** The line a sheet uses to explain a refusal or a failure. */
export function SheetError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(16, 26, 51, 0.34)" },
  scrimTap: { flex: 1 },
  panel: {
    maxHeight: "88%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.surfacePage,
  },
  grip: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: space.sm,
    backgroundColor: colors.rule,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  body: { paddingHorizontal: layout.gutter, paddingBottom: space.lg, gap: space.lg },
  footer: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.rule,
  },
  error: {
    fontFamily: fontFamily.ui,
    fontSize: fontSize.sm,
    lineHeight: 20,
    color: colors.textDown,
  },
});
