import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { gatherForecastInputs } from "@/lib/engine/allocation/load";
import { buildForecast } from "@/lib/engine/allocation";
import { narrateForecast } from "@/lib/engine/allocation/narrate";

export const maxDuration = 120;

/**
 * Capital-allocation forecaster. POST recomputes the forecast from live data and
 * the user's portfolio, narrates it (explanatory LLM, numeric-guarded), and
 * persists the full payload. GET returns the latest saved forecast.
 */
export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const output = await logAgentRun(supabase, user.id, "allocation_forecast", {}, async () => {
      const inputs = await gatherForecastInputs(supabase, user.id);
      const forecast = buildForecast(inputs);
      forecast.narrative = await narrateForecast(forecast);

      const { data: saved, error: insErr } = await supabase
        .from("allocation_forecasts")
        .insert({ user_id: user.id, model: forecast.narrative?.model ?? null, payload: forecast })
        .select("id, model, payload, created_at")
        .single();
      if (insErr) throw insErr;
      return { forecast: saved };
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { data, error: readErr } = await supabase
    .from("allocation_forecasts")
    .select("id, model, payload, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) return errorResponse(readErr);

  return NextResponse.json({ forecast: data ?? null });
}
