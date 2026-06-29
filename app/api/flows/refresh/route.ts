import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAndIngestForeignFlows, foreignFlowsAutoConfigured } from "@/lib/market/foreign-flows-ingest";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Foreign/local flow (FIPI/LIPI) auto-refresh. Best-effort: fetches the
 * configured provider (SCSTrade by default, custom JSON via NCCPL_FLOWS_URL
 * when selected). Protected by CRON_SECRET (Bearer header or ?key=). Safe to
 * schedule on weekdays after PSX close.
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
  return runAutoRefresh();
}

export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing." }, { status: 503 });
  }

  try {
    return await runAutoRefresh();
  } catch (err) {
    return errorResponse(err);
  }
}

async function runAutoRefresh() {
  if (!foreignFlowsAutoConfigured()) {
    return NextResponse.json({ ok: true, configured: false, message: "Foreign flow auto-fetch is disabled; flows are managed manually." });
  }

  const admin = createAdminClient();
  const result = await fetchAndIngestForeignFlows(admin);
  if (!result) {
    return NextResponse.json({ ok: false, configured: true, message: "Flow source unreachable or unparseable; manual entry remains the fallback." });
  }
  return NextResponse.json({ ok: true, configured: true, ...result, message: `Foreign flows refreshed for ${result.date}.` });
}
