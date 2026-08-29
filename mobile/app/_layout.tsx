import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
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
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { enableFreeze } from "react-native-screens";
import { AuthProvider, useAuth } from "@/lib/auth";
import { persister, queryClient } from "@/lib/query";
import { prefetch } from "@/lib/use-api";
import { Splash } from "@/components/ui/splash";
import { colors } from "@/lib/theme";

// Hold the native splash rather than letting it drop at the first render. It
// used to hand over before the fonts were in memory, so the animated splash
// drew its wordmark in a fallback face and then reflowed into Newsreader: a
// visible stutter right where the app makes its first impression.
void SplashScreen.preventAutoHideAsync();

// A screen the user has navigated away from stops re-rendering rather than
// staying live behind the one in front. Without this every tab keeps paying
// render cost for the whole session, which is what makes a five-tab app feel
// heavier the longer it is open.
enableFreeze(true);

/**
 * The screens worth having in hand before the tabs mount. Home is what the app
 * opens on; holdings is the tab most reached for next.
 */
const WARM = ["/api/portfolio/home", "/api/portfolio/holdings"] as const;

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

  // The native splash comes down only once the JS one can replace it in the
  // same frame, which is what makes the handoff invisible.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  if (!played) return <Splash onDone={() => setPlayed(true)} />;
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
        <Stack.Screen name="settings" />
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
  const { loading, session } = useAuth();

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

  // Warm the first screens while the splash is on the glass. This is the point
  // of the launch animation: it covers work that has to happen anyway, so the
  // 1.2 seconds it takes are 1.2 seconds the network is already using.
  useEffect(() => {
    if (!session) return;
    for (const path of WARM) void prefetch(path);
  }, [session]);

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
        {/* Restores the last session's responses from disk before the first
            screen mounts, so a cold start opens on the portfolio rather than
            on a skeleton while the first request crosses two oceans. */}
        <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
          <SafeAreaProvider>
            <AuthProvider>
              <StatusBar style="light" />
              <Shell />
            </AuthProvider>
          </SafeAreaProvider>
        </PersistQueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = {
  fill: { flex: 1 },
} as const;
