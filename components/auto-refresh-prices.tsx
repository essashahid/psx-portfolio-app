"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const STALE_MINUTES = 10;

/**
 * Keeps prices live without the user touching anything: fires a throttled
 * refresh on app load and every 10 minutes after. The API skips the PSX fetch
 * entirely when prices are fresh or the market is closed, so the steady-state
 * cost is one cheap DB check. Renders nothing and never blocks paint.
 */
export function AutoRefreshPrices() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (running.current) return;
      running.current = true;
      try {
        const res = await fetch("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: true, ifStaleMinutes: STALE_MINUTES }),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && (data.updated ?? 0) > 0) router.refresh();
      } catch {
        // Network hiccup — next interval will retry.
      } finally {
        running.current = false;
      }
    }

    tick();
    const id = setInterval(tick, STALE_MINUTES * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  return null;
}
