import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { loadDemoData, clearDemoData } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

export async function POST() {
  const { user, error } = await requireUser();
  if (error) return error;
  if (process.env.DEMO_ACCOUNT_EMAIL && user.email?.toLowerCase() === process.env.DEMO_ACCOUNT_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: "The shared demo workspace is read-only." }, { status: 403 });
  }
  try {
    await loadDemoData(createAdminClient(), user.id);
    return NextResponse.json({ ok: true, message: "Demo data loaded. Explore every page, then clear it from Settings when you import real data." });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  const { user, error } = await requireUser();
  if (error) return error;
  if (process.env.DEMO_ACCOUNT_EMAIL && user.email?.toLowerCase() === process.env.DEMO_ACCOUNT_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: "The shared demo workspace is read-only." }, { status: 403 });
  }
  try {
    await clearDemoData(createAdminClient(), user.id);
    return NextResponse.json({ ok: true, message: "Demo data cleared." });
  } catch (err) {
    return errorResponse(err);
  }
}
