import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { generateDividendForecasts, type ForecastResult } from "@/lib/dividends/forecast";

export const maxDuration = 60;

/** "Generate dividend forecasts" — projects next payouts from dividend history. */
export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const result = (await logAgentRun(supabase, user.id, "dividend_forecast", {}, async () =>
      ({ ...(await generateDividendForecasts(supabase, user.id)) })
    )) as unknown as ForecastResult;
    const parts = [`${result.generated} forecast(s) generated`];
    if (result.skippedExisting > 0) parts.push(`${result.skippedExisting} already exist`);
    if (result.insufficientHistory.length > 0)
      parts.push(`insufficient history for ${result.insufficientHistory.join(", ")}`);
    return NextResponse.json({
      ok: true,
      ...result,
      message: `${parts.join(" · ")}. Forecasts are estimates only — not announced dividends.`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
