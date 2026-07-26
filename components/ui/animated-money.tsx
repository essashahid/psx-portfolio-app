"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/shared/format";

function money(value: number, signed: boolean, currency: boolean, decimals: number) {
  const sign = signed ? (value < 0 ? "−" : "+") : value < 0 ? "−" : "";
  const magnitude = Math.abs(value).toLocaleString("en-PK", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}${currency ? "PKR " : ""}${magnitude}`;
}

/** A mount-only numeric transition for high-priority dashboard figures. */
export function AnimatedMoney({
  value,
  signed = false,
  delay = 0,
  duration = 1100,
  /** Off where a label already says PKR, so the unit is never printed twice. */
  currency = true,
  decimals = 2,
  className,
}: {
  value: number | null | undefined;
  signed?: boolean;
  delay?: number;
  duration?: number;
  currency?: boolean;
  decimals?: number;
  className?: string;
}) {
  const target = value ?? 0;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let frame = 0;
    let timeout = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      frame = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(frame);
    }

    const start = () => {
      const startedAt = performance.now();
      const step = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        setDisplay(target * eased);
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    timeout = window.setTimeout(start, delay);
    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [target, delay, duration]);

  return <span className={cn("tabular-nums", className)}>{money(display, signed, currency, decimals)}</span>;
}
