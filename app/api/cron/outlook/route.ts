import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/shared/cron-auth";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshOutlookData } from "@/lib/engine/outlook/refresh";
import { OUTLOOK_TAG } from "@/lib/engine/outlook/read";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Market Outlook refresh job.
 *
 * Two of the outlook's three model inputs are breadth measures derived from
 * every constituent's close, so without this job they freeze at whatever the
 * one-off backfill produced while the page keeps presenting them as current.
 * This appends the session's closes for the whole market and recomputes the
 * trailing breadth window, then clears the cached outlook.
 *
 * Scheduled after /api/cron/market so the index close is already stored; the
 * refresh checks for it and skips the price capture rather than recording an
 * intraday price as a close.
 *
 * Protected by CRON_SECRET (Bearer header or ?key=).
 *   ?force=1 captures closes even when the index has no new session yet.
 */
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, { status: 503 });
  }

  const started = Date.now();
  try {
    const admin = createAdminClient();
    const result = await refreshOutlookData(admin, { force: url.searchParams.get("force") === "1" });

    // The page reads a cached outlook; without this it would serve the old one
    // for up to an hour after fresh data landed.
    revalidateTag(OUTLOOK_TAG, "max");

    return NextResponse.json({ ok: true, ...result, elapsedMs: Date.now() - started });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), elapsedMs: Date.now() - started },
      { status: 500 }
    );
  }
}
