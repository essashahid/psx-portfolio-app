import type { CompanyReportPayload } from "./types";

export interface ReportVersionDiff {
  changedFigures: { field: string; previous: string | number | null; current: string | number | null }[];
  newSources: string[];
  removedSources: string[];
  newFilings: string[];
  newNews: string[];
  summary: string[];
}

export function computeReportDiff(previous: CompanyReportPayload | null, current: CompanyReportPayload): ReportVersionDiff {
  if (!previous) {
    return { changedFigures: [], newSources: [], removedSources: [], newFilings: [], newNews: [], summary: ["Initial report version."] };
  }

  const changedFigures: ReportVersionDiff["changedFigures"] = [];
  const prevQuote = previous.evidence.quote as { price?: number | null } | undefined;
  const currQuote = current.evidence.quote as { price?: number | null } | undefined;
  if (prevQuote?.price !== currQuote?.price) {
    changedFigures.push({ field: "Current price", previous: prevQuote?.price ?? null, current: currQuote?.price ?? null });
  }

  const prevPe = previous.charts.valuation.find((v) => v.name === "P/E")?.value;
  const currPe = current.charts.valuation.find((v) => v.name === "P/E")?.value;
  if (prevPe !== currPe) {
    changedFigures.push({ field: "P/E", previous: prevPe ?? null, current: currPe ?? null });
  }

  const prevSourceIds = new Set(previous.sources.map((s) => s.id));
  const currSourceIds = new Set(current.sources.map((s) => s.id));
  const newSources = current.sources.filter((s) => !prevSourceIds.has(s.id)).map((s) => s.label);
  const removedSources = previous.sources.filter((s) => !currSourceIds.has(s.id)).map((s) => s.label);

  const prevFilings = (previous.evidence.officialFilings as { title: string }[] | undefined) ?? [];
  const currFilings = (current.evidence.officialFilings as { title: string }[] | undefined) ?? [];
  const prevFilingTitles = new Set(prevFilings.map((f) => f.title));
  const newFilings = currFilings.filter((f) => !prevFilingTitles.has(f.title)).map((f) => f.title);

  const prevNews = (previous.evidence.independentNews as { title: string }[] | undefined) ?? [];
  const currNews = (current.evidence.independentNews as { title: string }[] | undefined) ?? [];
  const prevNewsTitles = new Set(prevNews.map((n) => n.title));
  const newNews = currNews.filter((n) => !prevNewsTitles.has(n.title)).map((n) => n.title);

  const summary: string[] = [];
  if (changedFigures.length) summary.push(`${changedFigures.length} figure(s) updated`);
  if (newFilings.length) summary.push(`${newFilings.length} new official filing(s)`);
  if (newNews.length) summary.push(`${newNews.length} new relevant news article(s)`);
  if (newSources.length) summary.push(`${newSources.length} new source(s)`);
  if (!summary.length) summary.push("No material changes detected.");

  return { changedFigures, newSources, removedSources, newFilings, newNews, summary };
}

export async function getLatestReportVersion(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string,
  ticker: string
): Promise<{ id: string; version: number; payload: CompanyReportPayload } | null> {
  const { data } = await supabase
    .from("ai_briefings")
    .select("id, meta")
    .eq("user_id", userId)
    .eq("ticker", ticker.toUpperCase())
    .eq("briefing_type", "company_report")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.meta) return null;
  const meta = data.meta as { reportVersion?: number; reportPayload?: CompanyReportPayload };
  if (!meta.reportPayload) return null;
  return { id: data.id, version: meta.reportVersion ?? 1, payload: meta.reportPayload };
}
