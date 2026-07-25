import type { ReactNode } from "react";
import { cn } from "@/lib/shared/format";

const TONE_CLASS: Record<string, string> = {
  paper: "bg-surface-page",
  indigo: "bg-[var(--surface-field-indigo)]",
  saffron: "bg-[var(--surface-field-saffron)]",
  clay: "bg-[var(--surface-field-clay)]",
  ink: "bg-[var(--surface-field-ink)] text-[var(--text-on-dark)]",
};

/**
 * Full-bleed section: the redesign's structural unit. Sections are separated
 * by rules and tinted colour fields, not by stacked cards.
 */
export function Band({
  tone = "paper",
  rule = "bottom",
  className,
  children,
}: {
  tone?: "paper" | "indigo" | "saffron" | "clay" | "ink";
  rule?: "bottom" | "none";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "px-0 py-6 sm:py-8",
        TONE_CLASS[tone],
        rule === "bottom" && "border-b border-rule",
        className
      )}
    >
      {children}
    </section>
  );
}
