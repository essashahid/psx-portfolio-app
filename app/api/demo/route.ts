import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { loadDemoData, clearDemoData } from "@/lib/demo";

export const maxDuration = 120;

export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  try {
    await loadDemoData(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Demo data loaded. Explore every page, then clear it from Settings when you import real data." });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  try {
    await clearDemoData(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Demo data cleared." });
  } catch (err) {
    return errorResponse(err);
  }
}
