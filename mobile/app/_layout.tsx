import { useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import {
  Newsreader_400Regular,
  Newsreader_500Medium,
} from "@expo-google-fonts/newsreader";
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";
import {
  GeistMono_400Regular,
  GeistMono_500Medium,
  GeistMono_600SemiBold,
} from "@expo-google-fonts/geist-mono";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Splash } from "@/components/ui/splash";
import { colors } from "@/lib/theme";

/**
 * Holds the first frame until the launch sequence has played AND the app is
 * genuinely ready.
 *
 * Both conditions matter. Cutting the sequence off mid-stage the moment the
 * session resolves looks like a glitch, and releasing on the timer alone would
 * hand over to a screen that has nothing to draw. Waiting on the longer of the
 * two is what makes the animation fill work rather than add to it.
 */
function Launch({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  const [played, setPlayed] = useState(false);
  if (!played || !ready) return <Splash onDone={() => setPlayed(true)} />;
  return <>{children}</>;
}

function RootNavigator() {
  const { session } = useAuth();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surfacePage },
        // A pushed screen comes in from the edge it will return to, which is
        // what makes back feel like the reverse of the way you came.
        animation: "slide_from_right",
      }}
    >
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="alerts" />
        <Stack.Screen name="dividends" />
        <Stack.Screen name="performance" />
        <Stack.Screen name="ledger" />
        <Stack.Screen name="news" />
        <Stack.Screen name="research" />
        <Stack.Screen name="company/[ticker]" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        {/* Signing in and out is a change of context rather than a step
            forward, so it fades instead of sliding. */}
        <Stack.Screen name="login" options={{ animation: "fade" }} />
      </Stack.Protected>
    </Stack>
  );
}

function Shell() {
  const { loading } = useAuth();

  // The type system carries the brand, so hold the first frame until the faces
  // are in memory rather than letting the app repaint from a fallback. The
  // stored session has to be read back too, otherwise a returning user sees
  // the login screen for a frame and the tabs fire requests with no token.
  const [fontsReady] = useFonts({
    Newsreader_400Regular,
    Newsreader_500Medium,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
    GeistMono_600SemiBold,
  });

  return (
    <Launch ready={fontsReady && !loading}>
      <RootNavigator />
    </Launch>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.fill}>
      {/* Measures the keyboard from the native side, which is the only way a
          sheet inside a Modal can know to lift itself: a Modal is its own
          window, so the activity's adjustResize never reaches it. */}
      <KeyboardProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <Shell />
          </AuthProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = {
  fill: { flex: 1 },
} as const;
