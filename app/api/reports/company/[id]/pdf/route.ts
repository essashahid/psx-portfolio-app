import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { renderCompanyReportPdf } from "@/lib/company/report-pdf";
import type { CompanyReportPayload } from "@/lib/company/report";

export const maxDuration = 120;
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const { id } = await params;
    const { data, error: dbError } = await supabase
      .from("ai_briefings")
      .select("id, ticker, title, meta")
      .eq("user_id", user.id)
      .eq("id", id)
      .eq("briefing_type", "company_report")
      .maybeSingle();
    if (dbError) throw dbError;
    if (!data) return NextResponse.json({ error: "Report not found." }, { status: 404 });

    const payload = (data.meta as { reportPayload?: CompanyReportPayload } | null)?.reportPayload;
    if (!payload) return NextResponse.json({ error: "This report does not have a PDF payload. Regenerate it." }, { status: 409 });

    const pdf = await renderCompanyReportPdf(payload);
    const filename = `${String(data.ticker ?? "company").toUpperCase()}-research-report.pdf`;

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
