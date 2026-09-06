import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/shared/api";
import { recordEvents, isEventName, type AppEvent } from "@/lib/telemetry/events";
import { RATE_LIMITS, rateLimitResponse, clientAddress } from "@/lib/shared/rate-limit";

const Schema = z.object({
  visitorId: z.string().max(120).optional(),
  events: z
    .array(
      z.object({
        name: z.string().max(64),
        surface: z.enum(["web", "mobile"]),
        path: z.string().max(300).nullable().optional(),
        props: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1)
    .max(50),
});

/**
 * POST /api/events. Accepts a small batch from web or phone. Signed-in
 * callers are attributed; anonymous calls (the login and waitlist pages)
 * carry a visitor id only. Unknown event names are dropped, not stored.
 */
export async function POST(request: Request) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 422 });

  const auth = await requireUser();
  const userId = auth.error ? null : auth.user.id;
  const subject = userId ?? clientAddress(request);
  const limited = await rateLimitResponse(RATE_LIMITS.events, subject, "Too many events.");
  if (limited) return limited;

  const events: AppEvent[] = parsed.data.events
    .filter((e) => isEventName(e.name))
    .map((e) => ({ name: e.name as AppEvent["name"], surface: e.surface, path: e.path ?? null, props: e.props ?? {} }));
  await recordEvents(userId, events, parsed.data.visitorId ?? null);
  return NextResponse.json({ ok: true, stored: events.length });
}
