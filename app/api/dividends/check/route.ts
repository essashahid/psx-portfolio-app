import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { checkUpcomingDividends, type DetectResult } from "@/lib/dividends/detect";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 120;

/** "Check upcoming dividends" — scans PSX announcements for every holding. */
export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const result = (await logAgentRun(supabase, user.id, "dividend_detection", {}, async () =>
      ({ ...(await checkUpcomingDividends(supabase, user.id)) })
    )) as unknown as DetectResult;
    const parts = [
      `${result.checkedTickers} holding(s) checked`,
      `${result.staged} new dividend event(s) staged`,
    ];
    if (result.upgraded > 0) parts.push(`${result.upgraded} upgraded with PDF values`);
    if (result.pdfsRead > 0) parts.push(`${result.pdfsRead} announcement PDF(s) read`);
    if (result.skippedDuplicates > 0) parts.push(`${result.skippedDuplicates} already known`);
    if (result.lowConfidence > 0) parts.push(`${result.lowConfidence} low-confidence (hidden by default)`);
    if (result.errors.length > 0) parts.push(`${result.errors.length} source error(s)`);
    return NextResponse.json({ ok: true, ...result, message: `${parts.join(" · ")}.` });
  } catch (err) {
    return errorResponse(err);
  }
}
