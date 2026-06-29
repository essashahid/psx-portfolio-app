import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { getReportPreview } from "@/lib/company/report";
import { accountHasFeature } from "@/lib/features";

export async function GET(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!(await accountHasFeature(supabase, user.id, "company_reports"))) {
    return NextResponse.json({ error: "Company reports are disabled for this account." }, { status: 403 });
  }

  const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

  try {
    const preview = await getReportPreview(supabase, user.id, ticker);
    return NextResponse.json(preview);
  } catch (err) {
    return errorResponse(err);
  }
}
