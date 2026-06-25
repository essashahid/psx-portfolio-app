import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyReportOptions } from "./types";

export interface ReportJobStage {
  key: string;
  label: string;
  status: "completed" | "skipped" | "failed" | "running" | "pending";
  detail?: string;
  completedAt?: string;
}

export interface ReportJobRow {
  id: string;
  user_id: string;
  ticker: string;
  status: string;
  options: CompanyReportOptions;
  stages: ReportJobStage[];
  parent_report_id: string | null;
  result_briefing_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export async function createReportJob(
  supabase: SupabaseClient,
  userId: string,
  ticker: string,
  options: CompanyReportOptions,
  parentReportId?: string | null
): Promise<string> {
  const initialStages: ReportJobStage[] = [
    { key: "resolve", label: "Resolved company identity", status: "pending" },
    { key: "quote", label: "Refreshed market price", status: "pending" },
    { key: "history", label: "Loaded historical price data", status: "pending" },
    { key: "financials", label: "Loaded financial statements", status: "pending" },
    { key: "periods", label: "Normalized financial periods", status: "pending" },
    { key: "filings", label: "Retrieved official PSX filings", status: "pending" },
    { key: "news", label: "Filtering verified company news", status: "pending" },
    { key: "ratios", label: "Calculated valuation metrics", status: "pending" },
    { key: "peers", label: "Compared peers", status: "pending" },
    { key: "portfolio", label: "Built portfolio analysis", status: "pending" },
    { key: "narrative", label: "Writing sourced interpretation", status: "pending" },
    { key: "charts", label: "Rendering charts", status: "pending" },
    { key: "validation", label: "Validating citations", status: "pending" },
    { key: "export", label: "Preparing export", status: "pending" },
  ];

  const { data, error } = await supabase
    .from("company_report_jobs")
    .insert({
      user_id: userId,
      ticker: ticker.toUpperCase(),
      status: "running",
      options,
      stages: initialStages,
      parent_report_id: parentReportId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateReportJobStages(
  supabase: SupabaseClient,
  jobId: string,
  stages: ReportJobStage[]
): Promise<void> {
  await supabase.from("company_report_jobs").update({ stages }).eq("id", jobId);
}

export async function completeReportJob(
  supabase: SupabaseClient,
  jobId: string,
  briefingId: string,
  stages: ReportJobStage[]
): Promise<void> {
  await supabase
    .from("company_report_jobs")
    .update({
      status: "completed",
      result_briefing_id: briefingId,
      stages,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function failReportJob(
  supabase: SupabaseClient,
  jobId: string,
  error: string,
  stages: ReportJobStage[]
): Promise<void> {
  await supabase
    .from("company_report_jobs")
    .update({
      status: "failed",
      error: error.slice(0, 500),
      stages,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function getReportJob(supabase: SupabaseClient, jobId: string, userId: string): Promise<ReportJobRow | null> {
  const { data } = await supabase
    .from("company_report_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as ReportJobRow | null) ?? null;
}

export function syncJobStages(
  jobStages: ReportJobStage[],
  key: string,
  status: ReportJobStage["status"],
  detail?: string
): ReportJobStage[] {
  return jobStages.map((s) =>
    s.key === key
      ? { ...s, status, detail, completedAt: status === "completed" || status === "failed" || status === "skipped" ? new Date().toISOString() : s.completedAt }
      : s
  );
}
