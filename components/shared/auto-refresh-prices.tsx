"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isMarketOpen } from "@psx/shared/market/trading-day";

/** How old the stored price may be before the API refetches it. */
const STALE_MINUTES = 2;
/** How often an open tab asks. */
const REFRESH_MINUTES = 10;

/**
 * Keeps prices live without the user touching anything.
 *
 * Three conditions gate a request, and all three exist because this mounts in
 * the app shell, so it runs on every signed-in page in every open tab:
 *
 *   the market is open   PSX trades 09:30 to 15:30 PKT. Outside that the API
 *                        skips the PSX fetch anyway and can only answer
 *                        "nothing changed", so the call is pure cost.
 *   the tab is visible   a backgrounded tab polling every ten minutes buys
 *                        nothing; it refreshes when the reader comes back.
 *   nothing in flight    the previous request has returned.
 *
 * A refresh that changes a price calls router.refresh(), which re-renders a
 * force-dynamic page from the server, so this deliberately does not fire often.
 */
export function AutoRefreshPrices() {
  const router = useRouter();
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (running.current || document.hidden || !isMarketOpen()) return;
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
        // Network hiccup — the next interval will retry.
      } finally {
        running.current = false;
      }
    }

    tick();
    const id = setInterval(tick, REFRESH_MINUTES * 60_000);
    // Coming back to a tab that sat through the session should not wait out
    // the rest of the interval.
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
