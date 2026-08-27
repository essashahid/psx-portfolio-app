import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { isMarketOpen } from "@psx/shared/market/trading-day";

/**
 * Whether the exchange is trading, kept true for as long as the screen is on
 * screen rather than decided once when it rendered.
 *
 * A phone left open across 15:30 would otherwise keep pulsing at a closed
 * market. The app-state listener covers the other direction: a phone locked
 * before the open and unlocked after it gets no timer ticks in between.
 */
export function useMarketOpen(): boolean {
  const [open, setOpen] = useState(() => isMarketOpen());

  useEffect(() => {
    const settle = () => setOpen(isMarketOpen());
    // A minute is fine: the boundaries this guards are 09:30 and 15:30.
    const timer = setInterval(settle, 60_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") settle();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  return open;
}
