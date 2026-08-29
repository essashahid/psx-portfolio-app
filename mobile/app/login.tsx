import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { Wordmark } from "@/components/ui/mark";
import { APP_PROMISE, DISCLAIMER_SHORT } from "@/lib/brand";
import {
  colors,
  palette,
  fontFamily,
  fontSize,
  layout,
  letterSpacing,
  space,
  tracking,
} from "@/lib/theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // The headline holds the field open when there is room, but once the keyboard
  // is up that space is what pushes the password field and the button off the
  // screen. Collapsing it is what keeps the whole form reachable.
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  async function onSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* Android 15 enforces edge-to-edge, which makes the manifest's
          adjustResize a no-op: the window no longer shrinks for the keyboard,
          so a plain KeyboardAvoidingView had nothing to react to and the
          fields stayed underneath it. This one measures the keyboard from the
          native side through WindowInsets, which is the only thing that still
          reports it, and scrolls the focused field clear of the top edge. */}
      <KeyboardAwareScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={space.xl}
      >
          <Wordmark size={26} textSize={fontSize.h1} />

          <Text style={styles.headline}>
            Your book,{"\n"}measured against{"\n"}the market.
          </Text>
          <Text style={styles.promise}>{APP_PROMISE}</Text>

          {/* The form sits at the foot of the field, thumb first. */}
          <View style={keyboardUp ? styles.spacerClosed : styles.spacer} />

          <View style={styles.form}>
            <View>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                placeholder="you@example.com"
                placeholderTextColor={colors.textOnDarkFaint}
                editable={!busy}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                submitBehavior="submit"
              />
            </View>

            <View>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                ref={passwordRef}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                placeholderTextColor={colors.textOnDarkFaint}
                editable={!busy}
                onSubmitEditing={onSubmit}
                returnKeyType="go"
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/* Label left, a dot in a disc on the right: the handoff's sign-in
                button, which reads as a control rather than a banner. */}
            <Pressable
              style={[styles.signIn, !canSubmit && styles.inert]}
              onPress={onSubmit}
              disabled={!canSubmit}
              accessibilityRole="button"
            >
              <Text style={styles.signInLabel}>{busy ? "Signing in" : "Sign in"}</Text>
              <View style={styles.disc}>
                <View style={styles.dot} />
              </View>
            </Pressable>
          </View>

          <Text style={styles.footnote}>{DISCLAIMER_SHORT}</Text>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: layout.gutter,
    paddingTop: space.xxl + space.sm,
    paddingBottom: space.xl,
  },
  headline: {
    marginTop: 48,
    fontFamily: fontFamily.display,
    fontSize: 34,
    lineHeight: 39,
    letterSpacing: letterSpacing(34, tracking.editorial),
    color: colors.textOnDark,
  },
  promise: {
    marginTop: space.lg + 2,
    maxWidth: 340,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.body,
    lineHeight: 24,
    color: colors.textOnDarkMuted,
  },
  spacer: { flexGrow: 1, minHeight: space.xxl },
  spacerClosed: { height: space.xl },
  form: { gap: space.md + 2 },
  fieldLabel: {
    marginBottom: 7,
    fontFamily: fontFamily.uiBold,
    fontSize: fontSize.xxxs,
    letterSpacing: letterSpacing(fontSize.xxxs, tracking.caps),
    color: colors.textOnDarkMuted,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: layout.radiusSm,
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 14,
    fontFamily: fontFamily.ui,
    fontSize: 16,
    color: colors.textOnDark,
  },
  error: { fontFamily: fontFamily.ui, fontSize: fontSize.sm, color: palette.down3 },
  signIn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.surfacePage,
    paddingLeft: 22,
    paddingRight: space.sm,
  },
  inert: { opacity: 0.45 },
  signInLabel: {
    fontFamily: fontFamily.uiSemibold,
    fontSize: fontSize.body,
    color: colors.textStrong,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 9, height: 9, borderRadius: layout.radiusPill, backgroundColor: colors.surfacePage },
  footnote: {
    marginTop: space.xl,
    fontFamily: fontFamily.ui,
    fontSize: fontSize.xxs,
    lineHeight: 17,
    color: "rgba(242,243,247,0.5)",
  },
});
