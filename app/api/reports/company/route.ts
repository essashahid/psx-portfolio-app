import { NextResponse } from "next/server";
import { after } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { aiAvailable } from "@/lib/ai/openai";
import {
  generateCompanyReport,
  normalizeCompanyReportOptions,
  runReportJob,
  startReportJob,
  type CompanyReportOptions,
} from "@/lib/company/report";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

export async function GET(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const url = new URL(request.url);
  const ticker = url.searchParams.get("ticker")?.toUpperCase().trim();
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20));

  let query = supabase
    .from("ai_briefings")
    .select("id, ticker, title, created_at, model, meta")
    .eq("user_id", user.id)
    .eq("briefing_type", "company_report")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (ticker) query = query.eq("ticker", ticker);

  const { data, error: dbError } = await query;
  if (dbError) return errorResponse(dbError);

  return NextResponse.json({
    reports: (data ?? []).map((r) => ({
      id: r.id,
      ticker: r.ticker,
      title: r.title,
      createdAt: r.created_at,
      reportVersion: (r.meta as { reportVersion?: number })?.reportVersion ?? 1,
      parentReportId: (r.meta as { parentReportId?: string })?.parentReportId ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!aiAvailable()) {
    return NextResponse.json({ error: "AI provider is not configured." }, { status: 503 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      ticker?: string;
      options?: Partial<CompanyReportOptions>;
      async?: boolean;
      refreshFromId?: string;
    };
    const ticker = body.ticker?.toUpperCase().trim();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    const options = normalizeCompanyReportOptions(body.options);

    if (body.async) {
      const jobId = await startReportJob(supabase, user.id, ticker, options, body.refreshFromId ?? null);
      const admin = createAdminClient();
      after(async () => {
        try {
          await runReportJob(admin, user.id, jobId);
        } catch (err) {
          console.error("report job failed", jobId, err);
        }
      });
      return NextResponse.json({ jobId, status: "running", message: "Report generation started." });
    }

    const output = await logAgentRun(supabase, user.id, "company_report", { ticker, options }, async () =>
      generateCompanyReport(supabase, user.id, ticker, options, {
        parentReportId: body.refreshFromId ?? undefined,
      })
    );

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
