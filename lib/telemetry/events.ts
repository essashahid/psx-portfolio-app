import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Product events for the beta. Names are a closed list so the admin page can
 * count them without guessing; add here first, then emit.
 */
export const EVENT_NAMES = [
  "page_view",
  "onboarding_completed",
  "holding_added",
  "import_opened",
  "import_committed",
  "company_viewed",
  "company_tab_viewed",
  "chat_asked",
  "dividends_viewed",
  "alerts_viewed",
  "feedback_sent",
  "push_interest",
  "discrepancy_reported",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
const NAME_SET = new Set<string>(EVENT_NAMES);

export interface AppEvent {
  name: EventName;
  surface: "web" | "mobile";
  path?: string | null;
  props?: Record<string, unknown>;
}

export function isEventName(name: unknown): name is EventName {
  return typeof name === "string" && NAME_SET.has(name);
}

/** Server-side write. Best effort: telemetry must never fail a request. */
export async function recordEvents(userId: string | null, events: AppEvent[], visitorId: string | null = null): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || events.length === 0) return;
  try {
    await createAdminClient().from("app_events").insert(
      events.slice(0, 50).map((e) => ({
        user_id: userId,
        visitor_id: visitorId,
        surface: e.surface,
        name: e.name,
        path: e.path ?? null,
        props: e.props ?? {},
      }))
    );
  } catch {
    /* best effort */
  }
}

/** Convenience for server code that already knows the user. */
export async function track(userId: string | null, name: EventName, props: Record<string, unknown> = {}, surface: "web" | "mobile" = "web", path: string | null = null) {
  await recordEvents(userId, [{ name, surface, path, props }]);
}
