import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { refreshAlerts } from "@/lib/alerts";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 60;

export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;
  try {
    const result = await refreshAlerts(supabase, user.id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
