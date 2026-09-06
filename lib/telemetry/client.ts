"use client";

import type { EventName } from "@/lib/telemetry/events";

/**
 * Browser-side tracking. Fire and forget: a failed beacon is never surfaced
 * and never retried, because telemetry that gets in the user's way is worse
 * than telemetry that is missing a row.
 */
export function track(name: EventName, props: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ events: [{ name, surface: "web", path: window.location.pathname, props }] });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through */
  }
  void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
}
