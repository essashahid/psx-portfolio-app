"use client";

import { useEffect, useRef } from "react";

/**
 * Records that the user has viewed a surface by stamping a last-seen timestamp
 * into profiles.prefs. Fires once on mount. The server reads the previous value
 * during render, so the "new since last visit" divider always reflects the
 * visit before this one.
 */
export function MarkSeen({ surface }: { surface: "news" | "dashboard" }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const key = surface === "news" ? "news_last_seen_at" : "dashboard_last_seen_at";
    void fetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: new Date().toISOString() }),
      keepalive: true,
    }).catch(() => {});
  }, [surface]);
  return null;
}
