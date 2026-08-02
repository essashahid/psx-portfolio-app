import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/shared/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { rejectDemoWrite } from "@/lib/demo/mode";
import { syncUniverseDirectory, reconcileListingStatus } from "@/lib/engine/universe";

export const maxDuration = 120;

/**
 * Sync the PSX stock universe from the official symbol directory
 * (~1,050 listings). Callable by a logged-in user or by cron with CRON_SECRET.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    const { supabase, user, error } = await requireUser();
    if (error) return error;
    const demoError = await rejectDemoWrite(supabase, user.id);
    if (demoError) return demoError;
  }
  return syncUniverse();
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return syncUniverse();
}

async function syncUniverse() {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
    }
    const db = createAdminClient();
    const result = await syncUniverseDirectory(db);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    const status = await reconcileListingStatus(db);
    return NextResponse.json({
      ok: true,
      ...result,
      ...status,
      message: `Stock universe synced: ${result.upserted} PSX listings (${result.delisted} delisted, ${status.suspended} suspended).`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
