import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors as lightColors, darkColors, type Colors } from "./theme";

/** What the user chose. "system" follows the phone, the other two override it. */
export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "plumb.theme";

type ThemeState = {
  /** The user's choice, which is what Settings shows. */
  mode: ThemeMode;
  /** What that resolves to right now — never "system". */
  scheme: "light" | "dark";
  colors: Colors;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  // Read the stored choice once. Until it lands the app follows the system,
  // which is the right guess and avoids a flash of the wrong palette.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === "light" || v === "dark" || v === "system") setModeState(v);
      })
      .catch(() => {
        // A failed read just means the default. Not worth surfacing.
      });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: "light" | "dark" = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;

  const value = useMemo<ThemeState>(
    () => ({ mode, scheme, colors: scheme === "dark" ? darkColors : lightColors, setMode }),
    [mode, scheme, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** Just the colours, which is all most components want. */
export function useColors(): Colors {
  return useTheme().colors;
}

/**
 * A themed replacement for StyleSheet.create.
 *
 * StyleSheet.create runs once at module load, so a stylesheet built from a
 * static palette can never repaint. Passing a factory instead defers it: the
 * sheet is built per scheme and cached, so switching themes is a re-render
 * rather than a reload, and a screen still pays the create cost only twice
 * over the life of the process.
 *
 *   const useStyles = makeStyles((c) => ({ page: { backgroundColor: c.surfacePage } }));
 *   const styles = useStyles();
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Colors) => T) {
  const cache = new Map<string, T>();
  return function useStyles(): T {
    const { scheme, colors } = useTheme();
    return useMemo(() => {
      const hit = cache.get(scheme);
      if (hit) return hit;
      const sheet = StyleSheet.create(factory(colors));
      cache.set(scheme, sheet);
      return sheet;
    }, [scheme, colors]);
  };
}
