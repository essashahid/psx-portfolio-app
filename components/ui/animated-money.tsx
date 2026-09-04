"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/shared/format";
import { durationToken } from "@/lib/shared/motion";

function money(value: number, signed: boolean, currency: boolean, decimals: number) {
  const sign = signed ? (value < 0 ? "−" : "+") : value < 0 ? "−" : "";
  const magnitude = Math.abs(value).toLocaleString("en-PK", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}${currency ? "PKR " : ""}${magnitude}`;
}

/** Decelerates into the final value instead of stopping dead. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * A headline figure counting up, once, on arrival.
 *
 * This is an entrance, not a notification: it belongs on the single headline
 * figure of a page — portfolio value, XIRR, the index level — and nowhere else.
 * A figure that changes while you watch should tick, not re-count, so the run
 * is guarded to first arrival. Without that guard a price refresh would send
 * the number back to zero and crawl up again, which reads as the page
 * reloading.
 *
 * Digits are tabular, or the number shifts sideways as it runs.
 */
export function AnimatedMoney({
  value,
  signed = false,
  delay = 0,
  /** Off where a label already says PKR, so the unit is never printed twice. */
  currency = true,
  decimals = 2,
  className,
}: {
  value: number | null | undefined;
  signed?: boolean;
  delay?: number;
  currency?: boolean;
  decimals?: number;
  className?: string;
}) {
  const target = value ?? 0;
  const [display, setDisplay] = useState(0);
  // A ref, not state: a re-render must not restage the entrance.
  const hasCounted = useRef(false);

  useEffect(() => {
    // Later changes land immediately. The count-up already happened.
    if (hasCounted.current) {
      setDisplay(target);
      return;
    }
    hasCounted.current = true;

    // --dur-count is 0 under prefers-reduced-motion, so the kill switch reaches
    // this without a second media query of its own.
    const duration = durationToken("--dur-count", 1300);
    if (duration === 0) {
      // Reduced motion: land on the final value immediately. The duration comes
      // from a CSS custom property, which is only readable once mounted.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplay(target);
      return;
    }

    let frame = 0;
    let timeout = 0;
    const start = () => {
      const startedAt = performance.now();
      const step = (now: number) => {
        const progress = Math.min((now - startedAt) / duration, 1);
        setDisplay(target * easeOut(progress));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    timeout = window.setTimeout(start, delay);
    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [target, delay]);

  return <span className={cn("tabular-nums", className)}>{money(display, signed, currency, decimals)}</span>;
}
