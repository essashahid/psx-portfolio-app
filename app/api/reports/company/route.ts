import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { aiAvailable } from "@/lib/ai/openai";
import { generateCompanyReport, normalizeCompanyReportOptions, type CompanyReportOptions } from "@/lib/company/report";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!aiAvailable()) {
    return NextResponse.json({ error: "AI provider is not configured. Add TASKS_API_KEY or DEEPSEEK_API_KEY in .env.local." }, { status: 503 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      ticker?: string;
      options?: Partial<CompanyReportOptions>;
    };
    const ticker = body.ticker?.toUpperCase().trim();
    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    const options = normalizeCompanyReportOptions(body.options);
    const output = await logAgentRun(supabase, user.id, "company_report", { ticker, options }, async () =>
      generateCompanyReport(supabase, user.id, ticker, options)
    );

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
