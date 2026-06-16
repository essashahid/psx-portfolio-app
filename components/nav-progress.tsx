"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin top-of-page progress bar (GitHub/YouTube style) that gives instant
 * feedback the moment any in-app navigation starts and completes once the new
 * route commits. Pairs with the per-link spinner in the sidebar so every click
 * gets an immediate response even while a server-rendered page is loading.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (trickle.current) clearInterval(trickle.current);
    if (hide.current) clearTimeout(hide.current);
    trickle.current = null;
    hide.current = null;
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setVisible(true);
    setProgress(12);
    // Ease toward 90% so the bar always feels alive without ever "finishing" early.
    trickle.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + (90 - p) * 0.18));
    }, 180);
  }, [clearTimers]);

  // Begin progress on any internal-link click (sidebar, cards, buttons-as-links).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/") || anchor.target === "_blank") return;
      const dest = new URL(anchor.href, window.location.href);
      // Skip same-page links and hash jumps — nothing actually navigates.
      if (dest.pathname === window.location.pathname && dest.search === window.location.search) {
        return;
      }
      start();
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as EventListenerOptions);
  }, [start]);

  // Route committed → snap to 100%, then fade out. Deferred to a frame so the
  // new page can paint first and we avoid synchronous setState in the effect.
  useEffect(() => {
    if (!visible) return;
    clearTimers();
    const frame = requestAnimationFrame(() => {
      setProgress(100);
      hide.current = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 280);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!visible) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5">
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--primary)] transition-[width] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }}
      />
    </div>
  );
}
