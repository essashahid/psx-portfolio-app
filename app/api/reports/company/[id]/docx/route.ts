import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { renderCompanyReportDocx } from "@/lib/company/report-docx";
import type { CompanyReportPayload } from "@/lib/company/report";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { id } = await params;

  try {
    const { data } = await supabase
      .from("ai_briefings")
      .select("title, ticker, meta")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("briefing_type", "company_report")
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const payload = (data.meta as { reportPayload?: CompanyReportPayload })?.reportPayload;
    if (!payload) return NextResponse.json({ error: "Report payload not available" }, { status: 400 });

    const buffer = await renderCompanyReportDocx(payload);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${data.ticker}-report-v${payload.reportVersion}.docx"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
