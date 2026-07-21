"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Confidence } from "@/lib/engine/outlook/presentation";

/**
 * Shared display pieces for the Outlook tab.
 *
 * Each exists to keep a technical quantity legible without hiding it: a sample
 * size becomes a confidence label, a percentile pair becomes a band with a
 * typical point marked, and the raw figures sit one click away rather than
 * leading the page.
 */

// --- Confidence chip -------------------------------------------------------

/**
 * A sample size in words. The count stays visible beside it, so the label
 * summarises the evidence rather than standing in for it.
 */
export function ConfidenceChip({
  confidence,
  independentWindows,
  since,
}: {
  confidence: Confidence;
  independentWindows: number;
  since?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge variant={confidence.variant}>{confidence.label}</Badge>
      <span className="text-[11px] text-muted-foreground">
        based on {independentWindows} separate historical periods
        {since ? ` since ${new Date(since).getFullYear()}` : ""}
      </span>
    </div>
  );
}

// --- Range indicator -------------------------------------------------------

const fmtSigned = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

/**
 * The middle 80% of historical outcomes as a band, with the typical result
 * marked. Replaces a percentile row, where the distance between the tenth and
 * ninetieth is the point being made and a table renders it as three numbers
 * that have to be mentally subtracted.
 *
 * The scale is shared across horizons by the caller, so switching window widens
 * the band visibly instead of rescaling the axis beneath it.
 */
export function RangeIndicator({
  p10,
  median,
  p90,
  domain,
}: {
  p10: number;
  median: number;
  p90: number;
  domain: { min: number; max: number };
}) {
  const span = domain.max - domain.min || 1;
  const toPct = (v: number) => ((v - domain.min) / span) * 100;
  const left = toPct(p10);
  const width = Math.max(toPct(p90) - left, 1);
  const medianPos = toPct(median);
  const zeroPos = toPct(0);
  const showZero = domain.min < 0 && domain.max > 0;

  return (
    <div>
      <div
        className="relative h-2 rounded-full bg-border"
        role="img"
        aria-label={`Middle 80 percent of outcomes ran from ${fmtSigned(p10)} to ${fmtSigned(p90)}, with a typical result of ${fmtSigned(median)}.`}
      >
        {showZero && (
          <span
            aria-hidden
            className="absolute -top-1 bottom-[-0.25rem] w-px bg-muted-foreground/35"
            style={{ left: `${zeroPos}%` }}
          />
        )}
        <span
          aria-hidden
          className="absolute top-0 h-2 rounded-full bg-brand-soft transition-[left,width] duration-(--dur-base) ease-(--ease-ui)"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <span
          aria-hidden
          className="absolute -top-1 h-4 w-4 -translate-x-2 rounded-full border-2 border-card bg-brand shadow-sm transition-[left] duration-(--dur-base) ease-(--ease-ui)"
          style={{ left: `${medianPos}%` }}
        />
      </div>
      <div className="mt-2.5 flex items-baseline justify-between text-[11px]">
        <span className="tabular-nums text-muted-foreground">{fmtSigned(p10)}</span>
        <span className="font-medium tabular-nums text-brand">Typically {fmtSigned(median)}</span>
        <span className="tabular-nums text-muted-foreground">{fmtSigned(p90)}</span>
      </div>
    </div>
  );
}

// --- Progressive disclosure ------------------------------------------------

/**
 * Collapsible panel for figures that would otherwise crowd the main reading.
 * Animated with a grid-row span so the panel expands to whatever it contains
 * without a measured height, and collapses to nothing when the duration tokens
 * are zeroed under reduced motion.
 */
export function Disclosure({
  label,
  openLabel,
  children,
}: {
  label: string;
  openLabel?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-[13px] text-muted-foreground",
          "transition-colors duration-(--dur-fast) ease-(--ease-ui) hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        )}
      >
        {open ? (openLabel ?? "Hide the detailed numbers") : label}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-(--dur-fast) ease-(--ease-ui)",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        id={panelId}
        className="grid transition-[grid-template-rows] duration-(--dur-base) ease-(--ease-ui)"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mt-2.5 rounded-lg bg-muted p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Label and value pair used inside a Disclosure panel. */
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}
