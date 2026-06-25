import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { getReportJob } from "@/lib/company/report/jobs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { id } = await params;
  const job = await getReportJob(supabase, id, user.id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  let result: unknown = null;
  if (job.status === "completed" && job.result_briefing_id) {
    const { data } = await supabase
      .from("ai_briefings")
      .select("id, title, content, created_at, model, meta")
      .eq("id", job.result_briefing_id)
      .eq("user_id", user.id)
      .maybeSingle();
    result = data;
  }

  return NextResponse.json({
    id: job.id,
    ticker: job.ticker,
    status: job.status,
    stages: job.stages,
    resultBriefingId: job.result_briefing_id,
    result,
    error: job.error,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
  });
}
