"use client";

import { useEffect } from "react";

/**
 * First-party error reporting for the browser. Uncaught errors and rejected
 * promises are posted to /api/errors, which stores them for the admin page.
 * Nothing is shown to the user here; the route error boundary does that.
 */
export function reportClientError(message: string, stack?: string | null) {
  try {
    const body = JSON.stringify({
      surface: "web",
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 8000) ?? null,
      path: typeof window !== "undefined" ? window.location.pathname : null,
    });
    void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* never throw from the reporter */
  }
}

export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError(e.message || "Unknown error", e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      reportClientError(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : null);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
