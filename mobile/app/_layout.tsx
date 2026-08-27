import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
import { colors } from "@/lib/theme";

function Splash() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator color={colors.accentPrimary} />
    </View>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();

  // Nothing renders until the stored session has been read back, otherwise a
  // returning user sees the login screen for a frame and the tab screens fire
  // API calls with no token attached.
  if (loading) return <Splash />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surfacePage } }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="alerts" />
        <Stack.Screen name="dividends" />
        <Stack.Screen name="performance" />
        <Stack.Screen name="research" />
        <Stack.Screen name="company/[ticker]" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // The type system carries the brand, so hold the first frame until the faces
  // are in memory rather than letting the app repaint from a fallback.
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
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" />
          {fontsReady ? <RootNavigator /> : <Splash />}
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = {
  fill: { flex: 1 },
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfacePage,
  },
} as const;
