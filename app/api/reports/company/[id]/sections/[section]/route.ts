import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { buildReportMarkdown } from "@/lib/company/report/markdown";
import { refreshReportSectionData } from "@/lib/company/report/sections";
import type { CompanyReportPayload } from "@/lib/company/report";

export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; section: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { id, section } = await params;

  try {
    const { data: row } = await supabase
      .from("ai_briefings")
      .select("id, ticker, title, meta")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("briefing_type", "company_report")
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const meta = row.meta as { reportPayload?: CompanyReportPayload; reportVersion?: number };
    if (!meta.reportPayload) return NextResponse.json({ error: "Report payload missing" }, { status: 400 });

    const updated = await refreshReportSectionData(supabase, user.id, section, meta.reportPayload);
    const content = buildReportMarkdown(updated);

    await supabase
      .from("ai_briefings")
      .update({
        content,
        meta: { ...meta, reportPayload: updated },
      })
      .eq("id", id);

    return NextResponse.json({ section, payload: updated, content });
  } catch (err) {
    return errorResponse(err);
  }
}
