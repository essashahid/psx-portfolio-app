"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/shared/format";

/**
 * A figure that tints when it changes: a notification, not an entrance.
 *
 * The opposite of AnimatedMoney, and never on the same figure. Count-up says
 * "this has arrived"; the tick says "this just moved". A figure doing both
 * would restart its entrance on every price refresh.
 *
 * The tint is the directional colour at 14% and it releases over --dur-base.
 * Colour never carries the meaning on its own — whatever sits beside this, the
 * signed percentage stays visible, because a red wash means nothing to a
 * reader who cannot separate red from green.
 */
const FLASH_MS = 320;

export function Tick({
  value,
  children,
  className,
}: {
  /** The number being watched. A change in this is what fires the tint. */
  value: number | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const previous = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;

    // The first value is an arrival, not a move; tinting it would flash the
    // whole table on load.
    if (before === undefined || before === null || value === null || value === undefined) return;
    if (value === before) return;

    setFlash(value > before ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span className={cn("tick", className)} data-flash={flash ?? undefined}>
      {children}
    </span>
  );
}
