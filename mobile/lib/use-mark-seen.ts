import { useEffect, useRef } from "react";
import { apiWrite } from "@/lib/api";

const KEYS = {
  news: "news_last_seen_at",
  dashboard: "dashboard_last_seen_at",
} as const;

/**
 * Records that this surface has been looked at.
 *
 * Two things make the timing matter. It fires only after the screen has
 * actually loaded, so a stamp is never written for a visit that failed. And it
 * fires once per visit rather than on every fetch: the count was read from the
 * response before this ran, and re-stamping on a pull-to-refresh would zero
 * the very line the user is still reading.
 *
 * The next visit then measures from this one, which is what "since your last
 * visit" is supposed to mean.
 */
export function useMarkSeen(surface: keyof typeof KEYS, ready: boolean) {
  const stamped = useRef(false);

  useEffect(() => {
    if (!ready || stamped.current) return;
    stamped.current = true;
    void apiWrite("/api/prefs", "POST", { [KEYS[surface]]: new Date().toISOString() }).catch(() => {
      // A missed stamp costs the next visit an accurate count, nothing more.
      // It is not worth an error in front of the news the user came to read.
    });
  }, [surface, ready]);
}
