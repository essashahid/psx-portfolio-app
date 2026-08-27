"use client";

import { useEffect, useState } from "react";

/**
 * The cold-start launch sequence.
 *
 * Three rules, in priority order:
 *
 * 1. Cold start only. A warm resume — a client-side navigation, a back button,
 *    a re-render — lands on the last screen the user was reading. The gate is
 *    the navigation timing entry plus a module-scope flag, not a render count,
 *    because a render count resets with the tree.
 * 2. Never hold the app back. It unmounts at --splash-total and no later. If
 *    data is slow the skeleton takes over; the splash does not stretch to cover
 *    it, because animation may only fill waiting that already exists.
 * 3. Under reduced motion the CSS collapses the animation to its final frame;
 *    this shows that frame for one paint and unmounts.
 */

/** Module scope: survives re-renders and remounts, dies with the document. */
let hasPlayed = false;

/** Kept in sync with --splash-total in globals.css. */
const SPLASH_TOTAL_MS = 1180;

function isColdStart(): boolean {
  if (hasPlayed) return false;
  if (typeof performance === "undefined") return false;

  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  // A reload or a back-forward restore is a warm resume: the user was already
  // here. Only a genuine navigate into the document earns the sequence.
  if (entry && entry.type !== "navigate") return false;

  // Far enough into the session that this cannot be the first paint — a route
  // change that happened to remount the shell, not a cold start.
  return performance.now() < SPLASH_TOTAL_MS;
}

export function PlumbSplash() {
  // Decided once, on mount, so a re-render cannot restage it.
  const [visible, setVisible] = useState(() => isColdStart());

  useEffect(() => {
    if (!visible) return;
    hasPlayed = true;

    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Reduced motion still gets a frame rather than a flash of nothing, but it
    // is a paint, not a wait.
    const timer = setTimeout(() => setVisible(false), reduced ? 0 : SPLASH_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="plumb-splash"
      role="status"
      aria-label="Plumb is starting"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: "#101a33",
      }}
    >
      <svg width="76" height="76" viewBox="0 0 64 64" aria-hidden="true">
        <rect
          className="plumb-splash__aperture"
          x="14"
          y="14"
          width="36"
          height="36"
          fill="none"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth="3.55"
        />
        <path
          className="plumb-splash__line"
          d="M32 4 V60"
          stroke="var(--indigo-3)"
          strokeWidth="3.55"
        />
        <circle className="plumb-splash__bob" cx="32" cy="60" r="3.6" fill="var(--indigo-3)" />
      </svg>

      <span
        className="plumb-splash__word"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 34,
          letterSpacing: "var(--tracking-editorial)",
          color: "var(--text-on-dark)",
        }}
      >
        Plumb
      </span>

      <p
        className="plumb-splash__foot"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "calc(34px + env(safe-area-inset-bottom))",
          margin: 0,
          textAlign: "center",
          fontSize: "var(--text-2xs)",
          color: "rgba(242,243,247,0.5)",
        }}
      >
        Portfolio tracking and research support.
        <br />
        Not financial advice.
      </p>
    </div>
  );
}
