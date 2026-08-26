"use client";

import { useEffect, useRef } from "react";

/**
 * Draws an SVG path in on first paint, and only first paint.
 *
 * The dash length has to be measured from the rendered path, so it is set as a
 * custom property once the element exists rather than guessed in CSS.
 *
 * Guarded with a ref rather than state: a chart that redraws whenever a filter
 * changes is exhausting, and a state flag resets with the re-render that a
 * filter change causes — which is exactly when the guard is needed.
 */
export function useDrawOnMount<T extends SVGPathElement>() {
  const ref = useRef<T | null>(null);
  const hasDrawn = useRef(false);

  useEffect(() => {
    const path = ref.current;
    if (!path || hasDrawn.current) return;
    hasDrawn.current = true;

    const length = path.getTotalLength();
    if (!Number.isFinite(length) || length === 0) return;

    path.style.setProperty("--draw-length", String(Math.ceil(length)));
    path.classList.add("draw-line");
  }, []);

  return ref;
}
