import Constants from "expo-constants";
import { apiWrite } from "./api";

/**
 * Product telemetry and error capture for the phone.
 *
 * Both are fire and forget. Telemetry must never slow a screen or surface a
 * failure of its own, so every call swallows its error. The names are the
 * closed list in lib/telemetry/events.ts on the web side; the server drops
 * anything it does not recognise, so a typo here is silent rather than a
 * crash, which is the right trade for a measurement.
 */
export type EventName =
  | "page_view"
  | "onboarding_completed"
  | "holding_added"
  | "import_opened"
  | "import_committed"
  | "company_viewed"
  | "company_tab_viewed"
  | "chat_asked"
  | "dividends_viewed"
  | "alerts_viewed"
  | "feedback_sent"
  | "push_interest"
  | "discrepancy_reported";

let currentPath: string | null = null;

/** The root layout keeps this current so every event carries where it happened. */
export function setTrackedPath(path: string | null) {
  currentPath = path;
}

export function appVersion(): string {
  return Constants.expoConfig?.version ?? "0.1.0";
}

export function track(name: EventName, props: Record<string, unknown> = {}, path: string | null = currentPath) {
  void apiWrite("/api/events", "POST", {
    events: [{ name, surface: "mobile", path, props }],
  }).catch(() => {
    // Best effort. A lost event is not worth a retry queue.
  });
}

/**
 * Reports a thrown error to POST /api/errors. The route accepts anonymous
 * reports, so this works before sign-in too; api() simply sends no bearer.
 */
export function reportError(error: unknown, path: string | null = currentPath) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const stack = error instanceof Error && error.stack ? error.stack.slice(0, 8000) : null;
  void apiWrite("/api/errors", "POST", {
    surface: "mobile",
    message: message.slice(0, 2000) || "Unknown error",
    stack,
    path,
    appVersion: appVersion(),
  }).catch(() => {
    // The reporter itself failing must never become a second error.
  });
}
