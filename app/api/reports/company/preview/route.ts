import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { getReportPreview } from "@/lib/company/report";

export async function GET(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  try {
    const preview = await getReportPreview(supabase, user.id, ticker);
    return NextResponse.json(preview);
  } catch (err) {
    return errorResponse(err);
  }
}
