"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/shared/format";

/**
 * The band stack arriving, once per session, on the hand-off from the splash.
 *
 * CSS cannot express "once": the class would restage the cascade every time the
 * page mounted, so returning to the dashboard from anywhere else would replay
 * a 580ms choreography over content the user has already read. That is latency
 * theatre — the animation would be filling a wait that is not happening.
 *
 * The flag is module scope so it survives remounts and dies with the document,
 * the same gate the splash uses. On coarse pointers the CSS drops the animation
 * anyway, where a cascade reads as lag rather than polish.
 */
let hasCascaded = false;

export function Cascade({ children, className }: { children: ReactNode; className?: string }) {
  // Decided on mount, so a re-render cannot restage it mid-flight.
  const [run] = useState(() => {
    if (hasCascaded) return false;
    hasCascaded = true;
    return true;
  });

  return <div className={cn(run && "cascade", className)}>{children}</div>;
}
