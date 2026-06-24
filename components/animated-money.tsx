"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function money(value: number, signed: boolean) {
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}PKR ${value.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A mount-only numeric transition for high-priority dashboard figures. */
export function AnimatedMoney({
  value,
  signed = false,
  delay = 0,
  duration = 1100,
  className,
}: {
  value: number | null | undefined;
  signed?: boolean;
  delay?: number;
  duration?: number;
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

  return <span className={cn("tabular-nums", className)}>{money(display, signed)}</span>;
}
