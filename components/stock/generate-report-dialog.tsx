"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CompanyReportViewer } from "@/components/stock/company-report-viewer";
import { cn, formatNumber } from "@/lib/utils";

type IncludeKey =
  | "businessOverview"
  | "financials"
  | "financialQuality"
  | "valuation"
  | "dividends"
  | "pricePerformance"
  | "filings"
  | "news"
  | "peers"
  | "catalystsRisks"
  | "scenarioAnalysis"
  | "portfolio"
  | "monitoring";

const INCLUDE_LABELS: { key: IncludeKey; label: string }[] = [
  { key: "businessOverview", label: "Business overview" },
  { key: "financials", label: "Financial performance" },
  { key: "financialQuality", label: "Financial quality" },
  { key: "valuation", label: "Valuation" },
  { key: "dividends", label: "Dividends and shareholder returns" },
  { key: "pricePerformance", label: "Price and benchmark performance" },
  { key: "filings", label: "Official filings" },
  { key: "news", label: "Verified company news" },
  { key: "peers", label: "Peer comparison" },
  { key: "catalystsRisks", label: "Catalysts and risks" },
  { key: "scenarioAnalysis", label: "Scenario analysis" },
  { key: "portfolio", label: "My portfolio position" },
  { key: "monitoring", label: "Monitoring checklist" },
];

const FULL_DEFAULTS: Record<IncludeKey, boolean> = {
  businessOverview: true,
  financials: true,
  financialQuality: true,
  valuation: true,
  dividends: true,
  pricePerformance: true,
  filings: true,
  news: true,
  peers: true,
  catalystsRisks: true,
  scenarioAnalysis: true,
  portfolio: true,
  monitoring: true,
};

const BRIEF_DEFAULTS: Record<IncludeKey, boolean> = {
  businessOverview: true,
  financials: true,
  financialQuality: false,
  valuation: true,
  dividends: true,
  pricePerformance: false,
  filings: true,
  news: true,
  peers: false,
  catalystsRisks: true,
  scenarioAnalysis: false,
  portfolio: true,
  monitoring: false,
};

const STAGE_LABELS = [
  "Resolved company identity",
  "Refreshed market price",
  "Loaded financial statements",
  "Normalized financial periods",
  "Retrieved official PSX filings",
  "Filtering verified company news",
  "Calculating valuation metrics",
  "Comparing peers",
  "Building portfolio analysis",
  "Writing sourced interpretation",
  "Rendering charts",
  "Validating citations",
  "Preparing export",
];

type Preview = {
  resolvable: boolean;
  error?: string;
  ticker: string;
  companyName?: string;
  sector?: string;
  exchange?: string;
  price?: number | null;
  priceUpdated?: string | null;
  financialsThrough?: string | null;
  portfolioShares?: number | null;
  filingsAvailable?: boolean;
  financialHistorySufficient?: boolean;
  suggestedPeers?: string[];
};

type GeneratedReport = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  meta?: { reportPayload?: unknown; stages?: { key: string; label: string; status: string }[] };
};

export function GenerateReportDialog({
  ticker,
  companyName,
  label = "Generate report",
  triggerVariant = "default",
  triggerSize = "default",
  triggerClassName,
}: {
  ticker: string;
  companyName?: string | null;
  label?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClassName?: string;
}) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [depth, setDepth] = useState<"full" | "brief">("full");
  const [periodYears, setPeriodYears] = useState<3 | 5>(5);
  const [include, setInclude] = useState<Record<IncludeKey, boolean>>(FULL_DEFAULTS);
  const [peerText, setPeerText] = useState("");
  const [newsPeriodDays, setNewsPeriodDays] = useState<30 | 90 | 180 | 365>(90);
  const [output, setOutput] = useState({ interactive: true, saveToResearch: true, exportPdf: false, exportDocx: false });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<{ label: string; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GeneratedReport | null>(null);

  const selectedPeers = useMemo(() => {
    const manual = peerText.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
    if (manual.length) return manual.slice(0, 5);
    return preview?.suggestedPeers ?? [];
  }, [peerText, preview?.suggestedPeers]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/reports/company/preview?ticker=${encodeURIComponent(ticker)}`);
      const data = (await res.json()) as Preview;
      setPreview(data);
      if (!peerText && data.suggestedPeers?.length) {
        setPeerText(data.suggestedPeers.join(" · "));
      }
    } catch {
      setPreview({ resolvable: false, error: "Could not load company preview.", ticker });
    } finally {
      setPreviewLoading(false);
    }
  }, [ticker, peerText]);

  function openDialog() {
    setOpen(true);
    loadPreview();
    setError(null);
    setReport(null);
    setStages([]);
  }

  function applyDepth(nextDepth: "full" | "brief") {
    setDepth(nextDepth);
    if (nextDepth === "brief") {
      setPeriodYears(3);
      setInclude(BRIEF_DEFAULTS);
      setNewsPeriodDays(90);
    } else {
      setPeriodYears(5);
      setInclude(FULL_DEFAULTS);
    }
  }

  function toggleInclude(key: IncludeKey) {
    setInclude((c) => ({ ...c, [key]: !c[key] }));
  }

  async function pollJob(jobId: string, signal: AbortSignal): Promise<GeneratedReport> {
    for (let i = 0; i < 180; i++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const res = await fetch(`/api/reports/company/jobs/${jobId}`, { signal });
      const job = await res.json();
      if (job.stages?.length) {
        setStages(job.stages.map((s: { label: string; status: string }) => ({ label: s.label, status: s.status })));
      }
      if (job.status === "completed" && job.result) {
        return job.result as GeneratedReport;
      }
      if (job.status === "failed") throw new Error(job.error ?? "Report generation failed.");
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Report generation timed out.");
  }

  async function generate() {
    if (!preview?.resolvable) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setReport(null);
    setStages(STAGE_LABELS.map((label) => ({ label, status: "pending" })));

    try {
      const res = await fetch("/api/reports/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ticker,
          async: true,
          options: {
            depth,
            periodYears,
            include,
            peers: selectedPeers,
            newsPeriodDays,
            output,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Report generation failed (${res.status})`);

      if (data.jobId) {
        const result = await pollJob(data.jobId, controller.signal);
        setReport(result);
      } else {
        const returnedStages = (data.stages as { label: string; status: string }[]) ?? [];
        if (returnedStages.length) {
          setStages(returnedStages.map((s) => ({ label: s.label, status: s.status })));
        }
        setReport(data.result);
      }
      router.refresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Report generation cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Report generation failed.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const canGenerate = preview?.resolvable && !running;

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} className={triggerClassName} onClick={openDialog}>
        <FileText className="h-3.5 w-3.5" />
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => (running ? cancel() : setOpen(false))}
        title={`Generate ${ticker} research report`}
        className="sm:max-w-2xl"
      >
        <div className="flex max-h-[min(80vh,720px)] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* Company identity */}
            <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
              {previewLoading ? (
                <p className="text-xs text-muted-foreground">Loading company data…</p>
              ) : preview?.resolvable ? (
                <>
                  <p className="text-sm font-semibold">
                    {ticker} · {preview.companyName ?? companyName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.sector} · {preview.exchange ?? "PSX"}
                  </p>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>Price: PKR {preview.price != null ? formatNumber(preview.price) : "—"}</span>
                    <span>Updated: {preview.priceUpdated?.slice(0, 10) ?? "—"}</span>
                    <span>Financials through: {preview.financialsThrough ?? "—"}</span>
                    <span>
                      {preview.portfolioShares ? `Owned: ${formatNumber(preview.portfolioShares, 0)} shares` : "Not in portfolio"}
                    </span>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-red-700">Report cannot be generated</p>
                  <p className="text-xs text-muted-foreground">{preview?.error ?? "Company metadata could not be resolved."}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={loadPreview}>
                      <RefreshCw className="h-3 w-3" /> Refresh company data
                    </Button>
                    <Link href={`/stocks/${ticker}`} className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted">
                      Review ticker mapping
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {!preview?.resolvable ? null : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <fieldset className="space-y-1.5">
                    <legend className="text-xs font-semibold">Report type</legend>
                    <label className="flex items-start gap-2 text-sm">
                        <input type="radio" className="mt-0.5" checked={depth === "full"} onChange={() => applyDepth("full")} />
                      <span>
                        <span className="font-medium">Full equity-research report</span>
                        <span className="block text-[11px] text-muted-foreground">Approximately 15–25 pages</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                        <input type="radio" className="mt-0.5" checked={depth === "brief"} onChange={() => applyDepth("brief")} />
                      <span>
                        <span className="font-medium">Concise investment brief</span>
                        <span className="block text-[11px] text-muted-foreground">Approximately 4–6 pages</span>
                      </span>
                    </label>
                  </fieldset>

                  <fieldset className="space-y-1.5">
                    <legend className="text-xs font-semibold">Analysis period</legend>
                    {([5, 3] as const).map((y) => (
                      <label key={y} className="flex items-center gap-2 text-sm">
                        <input type="radio" checked={periodYears === y} onChange={() => setPeriodYears(y)} />
                        {y} years
                      </label>
                    ))}
                  </fieldset>
                </div>

                <fieldset>
                  <legend className="text-xs font-semibold">Include</legend>
                  <div className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    {INCLUDE_LABELS.map((item) => (
                      <label key={item.key} className="flex items-center gap-2 text-sm py-0.5">
                        <input type="checkbox" checked={include[item.key]} onChange={() => toggleInclude(item.key)} />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {include.peers && (
                  <div>
                    <p className="text-xs font-semibold">Peer group</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Auto-selected: {selectedPeers.join(" · ") || "—"}
                    </p>
                    <input
                      value={peerText}
                      onChange={(e) => setPeerText(e.target.value.toUpperCase())}
                      placeholder="LUCK, DGKC, MLCF, CHCC"
                      className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <fieldset className="space-y-1.5">
                    <legend className="text-xs font-semibold">News period</legend>
                    {([30, 90, 180, 365] as const).map((d) => (
                      <label key={d} className="flex items-center gap-2 text-sm">
                        <input type="radio" checked={newsPeriodDays === d} onChange={() => setNewsPeriodDays(d)} />
                        {d === 30 ? "30 days" : d === 90 ? "90 days" : d === 180 ? "6 months" : "1 year"}
                      </label>
                    ))}
                  </fieldset>

                  <fieldset className="space-y-1.5">
                    <legend className="text-xs font-semibold">Output</legend>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={output.interactive} onChange={() => setOutput((o) => ({ ...o, interactive: !o.interactive }))} />
                      Interactive in-app report
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={output.saveToResearch} onChange={() => setOutput((o) => ({ ...o, saveToResearch: !o.saveToResearch }))} />
                      Save to Saved Research
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={output.exportPdf} onChange={() => setOutput((o) => ({ ...o, exportPdf: !o.exportPdf }))} />
                      Export PDF when ready
                    </label>
                  </fieldset>
                </div>

                <details className="text-xs" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
                  <summary className="cursor-pointer font-semibold">Advanced settings</summary>
                  <p className="mt-2 text-muted-foreground">
                    Before generation, the system will refresh: company metadata, market price, historical prices, financial statements,
                    official PSX filings, dividend history, verified news, peer metrics, and portfolio position.
                  </p>
                </details>
              </>
            )}

            {running && (
              <div className="rounded-md border border-border bg-muted/25 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Generating {ticker} research report</p>
                  <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
                </div>
                <div className="space-y-1">
                  {stages.map((step, i) => {
                    const done = step.status === "completed";
                    const failed = step.status === "failed";
                    const active = running && !done && !failed && i === stages.findIndex((s) => s.status === "pending");
                    return (
                      <div key={step.label} className={cn("flex items-center gap-2 text-xs", !done && !active && !failed && "text-muted-foreground")}>
                        {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : failed ? <XCircle className="h-3.5 w-3.5 text-red-600" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full border border-border" />}
                        {step.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-red-700">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Generation Failed</p>
                  <div className="mt-1 text-xs space-y-1">
                    {error.includes("Report validation failed:") ? (
                      <ul className="list-disc pl-4">
                        {error.replace("Report validation failed: ", "").split("; ").map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>{error}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {report?.meta?.reportPayload ? (
              <CompanyReportViewer
                payload={report.meta.reportPayload as import("@/lib/company/report").CompanyReportPayload}
                reportId={report.id}
              />
            ) : null}
          </div>

          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={running}>Cancel</Button>
            <Button onClick={generate} disabled={!canGenerate}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Generate report
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
