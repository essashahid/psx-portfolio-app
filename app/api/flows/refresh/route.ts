import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAndIngestForeignFlows, foreignFlowsAutoConfigured } from "@/lib/market/foreign-flows-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Foreign/local flow (FIPI/LIPI) auto-refresh. Best-effort: only does anything
 * when NCCPL_FLOWS_URL is configured. Protected by CRON_SECRET (Bearer header
 * or ?key=). Safe to schedule on weekdays after PSX close.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }
  if (!foreignFlowsAutoConfigured()) {
    return NextResponse.json({ ok: true, configured: false, note: "Set NCCPL_FLOWS_URL to enable auto-fetch; flows are managed manually." });
  }

  const admin = createAdminClient();
  const result = await fetchAndIngestForeignFlows(admin);
  if (!result) {
    return NextResponse.json({ ok: false, configured: true, note: "Source unreachable or unparseable; manual upload remains the source of truth." });
  }
  return NextResponse.json({ ok: true, configured: true, ...result });
}
