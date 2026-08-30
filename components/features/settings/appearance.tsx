"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/lib/use-theme";

const OPTIONS: { value: ThemeMode; label: string; hint: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", hint: "Follow your device", Icon: Monitor },
  { value: "light", label: "Light", hint: "The paper field", Icon: Sun },
  { value: "dark", label: "Dark", hint: "A true-black field", Icon: Moon },
];

/**
 * A device preference, not an account setting: it applies immediately and is
 * stored in this browser rather than saved with the rest of the profile.
 */
export function Appearance() {
  const { mode, setMode } = useTheme();

  return (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, hint, Icon }) => {
        const on = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setMode(value)}
            className={[
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              on
                ? "border-[var(--accent-primary)] bg-[var(--surface-field-indigo)]"
                : "border-[var(--rule)] hover:bg-[var(--surface-sunken)]",
            ].join(" ")}
          >
            <Icon
              className="mt-0.5 size-4 shrink-0"
              style={{ color: on ? "var(--accent-primary)" : "var(--text-muted)" }}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--text-strong)]">{label}</span>
              <span className="block text-xs text-[var(--text-muted)]">{hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
