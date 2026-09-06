import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startDemoSession } from "@/lib/demo/session";
import { errorResponse } from "@/lib/shared/api";
import { RATE_LIMITS, rateLimitResponse, clientAddress } from "@/lib/shared/rate-limit";

export const maxDuration = 120;

export async function POST(request: Request) {
  const limited = await rateLimitResponse(RATE_LIMITS.demo, clientAddress(request), "The demo is busy right now. Please try again in a few minutes.");
  if (limited) return limited;
  try {
    const supabase = await createClient();
    const result = await startDemoSession(supabase);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, redirectTo: "/dashboard" });
  } catch (err) {
    return errorResponse(err);
  }
}
