"use client";

import { useEffect, useState } from "react";

/**
 * The one pulse in the product: the market is open and the figure beside it is
 * live. It stops at the close, because a pulse running against a stale number
 * is a lie about freshness.
 *
 * A client component, and re-checking on a timer, for one reason: a page left
 * open across 15:30 would otherwise keep pulsing at a closed market. The
 * attribute has to stay true for as long as the page is on screen, not just at
 * the moment it rendered.
 */

/** PSX regular session, Karachi time. */
const OPEN_MINUTES = 9 * 60 + 30;
const CLOSE_MINUTES = 15 * 60 + 30;

function isMarketOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday");
  // The exchange does not trade at the weekend, so neither does the pulse.
  if (weekday === "Sat" || weekday === "Sun") return false;

  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
}

export function MarketPulse({ className }: { className?: string }) {
  // Starts closed so the server and the first client paint agree; the effect
  // settles it immediately after. A pulse that appears is better than one that
  // has to be taken away.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const settle = () => setOpen(isMarketOpen(new Date()));
    settle();
    // A minute is fine: the boundary this guards is 09:30 and 15:30.
    const timer = setInterval(settle, 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      className={`pulse-live ${className ?? ""}`}
      data-market={open ? "open" : "closed"}
      aria-hidden
    />
  );
}

export { isMarketOpen };
