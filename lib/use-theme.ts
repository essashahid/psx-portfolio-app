"use client";

import { useCallback, useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "./theme-script";

export type ThemeMode = "light" | "dark" | "system";

/**
 * The theme choice, mirrored from the phone app so both surfaces behave the
 * same way. "system" removes the attribute entirely and lets the CSS media
 * query decide, rather than resolving it here, so the page keeps following the
 * OS if the user changes it while the tab is open.
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") setModeState(stored);
    } catch {
      // Storage can throw in a private window. The system default is fine.
    }
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best effort; the attribute is already applied for this session.
    }
  }, []);

  return { mode, setMode };
}
