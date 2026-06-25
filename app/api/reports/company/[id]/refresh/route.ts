import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { generateCompanyReport } from "@/lib/company/report";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { id } = await params;

  try {
    const { data: existing } = await supabase
      .from("ai_briefings")
      .select("ticker, meta")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("briefing_type", "company_report")
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const meta = existing.meta as { options?: import("@/lib/company/report").CompanyReportOptions };
    const output = await generateCompanyReport(supabase, user.id, existing.ticker as string, meta.options, {
      parentReportId: id,
      previousPayload: (existing.meta as { reportPayload?: import("@/lib/company/report").CompanyReportPayload })?.reportPayload,
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
