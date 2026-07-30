import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startDemoSession } from "@/lib/demo/session";
import { errorResponse } from "@/lib/shared/api";

export const maxDuration = 120;

export async function POST() {
  try {
    const supabase = await createClient();
    const result = await startDemoSession(supabase);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, redirectTo: "/dashboard" });
  } catch (err) {
    return errorResponse(err);
  }
}
