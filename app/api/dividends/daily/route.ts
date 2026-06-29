import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { runDailyUpdate, type DailyUpdateSummary } from "@/lib/dividends/daily";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 300;

/**
 * "Run daily update" — the same proactive pipeline the cron runs, but for the
 * signed-in user on demand. Lets the user pull today's dividend/price/event
 * changes without waiting for the scheduled run.
 */
export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const summary = (await logAgentRun(supabase, user.id, "daily_update", {}, async () =>
      ({ ...(await runDailyUpdate(supabase, user.id)) })
    )) as unknown as DailyUpdateSummary;

    return NextResponse.json({
      ok: true,
      ...summary,
      message: summary.highlights.join(" · "),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
