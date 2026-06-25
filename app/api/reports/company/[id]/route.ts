import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { id } = await params;

  try {
    const { data, error: dbError } = await supabase
      .from("ai_briefings")
      .select("id, title, content, created_at, model, meta, ticker")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("briefing_type", "company_report")
      .maybeSingle();
    if (dbError) throw dbError;
    if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json({ result: data });
  } catch (err) {
    return errorResponse(err);
  }
}
