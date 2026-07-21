"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Filled segmented control for switching between mutually exclusive views.
 *
 * Distinct from Tabs, which is the underline bar for page-level sections. This
 * is a filter over one panel's contents, so it carries radiogroup semantics
 * rather than tab semantics: the options select a value, they do not reveal
 * separate panels.
 *
 * Keyboard handling follows the radiogroup pattern. A roving tabindex puts one
 * stop in the group, arrow keys move between options and select as they go,
 * and Home/End jump to the ends.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Announced to screen readers when the visible label is too terse alone. */
  hint?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Time window". */
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(currentIndex: number, delta: number) {
    const next = (currentIndex + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(index, -1);
        break;
      case "Home":
        e.preventDefault();
        move(index, -index);
        break;
      case "End":
        e.preventDefault();
        move(index, options.length - 1 - index);
        break;
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-2", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.hint ?? undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              // min-w-0 lets options shrink rather than overflow the card on a
              // narrow phone when the group carries four or more choices.
              "min-h-9 min-w-0 flex-1 rounded-md border px-2 text-[13px] font-medium sm:px-3",
              "transition-[background-color,color,border-color] duration-(--dur-fast) ease-(--ease-ui)",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card",
              selected
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
