"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { CompanyReportPayload } from "@/lib/company/report";

const SECTION_MAP: Record<string, string> = {
  executive: "businessOverview",
  financials: "financials",
  valuation: "valuation",
  peers: "peers",
  portfolio: "portfolio",
  scenarios: "scenarioAnalysis",
  news: "news",
  price: "pricePerformance",
};

export function SectionRefreshButton({
  reportId,
  sectionId,
  onUpdated,
}: {
  reportId: string;
  sectionId: string;
  onUpdated?: (payload: CompanyReportPayload) => void;
}) {
  const [loading, setLoading] = useState(false);
  const apiSection = SECTION_MAP[sectionId];
  if (!apiSection) return null;

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/company/${reportId}/sections/${apiSection}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Section refresh failed");
      onUpdated?.(data.payload as CompanyReportPayload);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Section refresh failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={loading}
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      Refresh
    </button>
  );
}
