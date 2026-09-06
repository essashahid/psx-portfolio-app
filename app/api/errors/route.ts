import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/shared/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, rateLimitResponse, clientAddress } from "@/lib/shared/rate-limit";

const Schema = z.object({
  surface: z.enum(["web", "mobile"]),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).nullable().optional(),
  path: z.string().max(300).nullable().optional(),
  appVersion: z.string().max(40).nullable().optional(),
});

/** POST /api/errors. First-party error capture for web and phone. */
export async function POST(request: Request) {
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 422 });
  const limited = await rateLimitResponse(RATE_LIMITS.errors, clientAddress(request), "Too many reports.");
  if (limited) return limited;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false }, { status: 503 });

  const auth = await requireUser();
  const userId = auth.error ? null : auth.user.id;
  try {
    await createAdminClient().from("client_errors").insert({
      user_id: userId,
      surface: parsed.data.surface,
      message: parsed.data.message,
      stack: parsed.data.stack ?? null,
      path: parsed.data.path ?? null,
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      app_version: parsed.data.appVersion ?? null,
    });
  } catch {
    /* best effort */
  }
  return NextResponse.json({ ok: true });
}
