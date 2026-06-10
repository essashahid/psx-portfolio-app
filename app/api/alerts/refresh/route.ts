import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { refreshAlerts } from "@/lib/alerts";

export const maxDuration = 60;

export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  try {
    const result = await refreshAlerts(supabase, user.id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
