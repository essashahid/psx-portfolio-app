"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, FileText, Loader2, XCircle } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

type IncludeKey =
  | "financials"
  | "valuation"
  | "dividends"
  | "pricePerformance"
  | "filings"
  | "news"
  | "peers"
  | "portfolio";

const INCLUDE_LABELS: { key: IncludeKey; label: string }[] = [
  { key: "financials", label: "Financial performance" },
  { key: "valuation", label: "Valuation" },
  { key: "dividends", label: "Dividends" },
  { key: "pricePerformance", label: "Price performance" },
  { key: "filings", label: "Official filings" },
  { key: "news", label: "Recent news" },
  { key: "peers", label: "Peer comparison" },
  { key: "portfolio", label: "My portfolio position" },
];

const DEFAULT_INCLUDE: Record<IncludeKey, boolean> = {
  financials: true,
  valuation: true,
  dividends: true,
  pricePerformance: true,
  filings: true,
  news: true,
  peers: true,
  portfolio: true,
};

const PROGRESS = [
  "Resolving company profile",
  "Refreshing latest quote",
  "Refreshing historical price data",
  "Loading latest financial statements and payouts",
  "Retrieving official PSX filings",
  "Checking recent verified news",
  "Comparing selected peers",
  "Preparing sourced analysis",
];

type GeneratedReport = {
  id: string;
  title: string;
  content: string;
  created_at: string;
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
  const [include, setInclude] = useState<Record<IncludeKey, boolean>>(DEFAULT_INCLUDE);
  const [peerText, setPeerText] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GeneratedReport | null>(null);

  const selectedPeers = useMemo(
    () => peerText.split(",").map((p) => p.trim().toUpperCase()).filter(Boolean).slice(0, 5),
    [peerText]
  );

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setActiveStep((step) => Math.min(step + 1, PROGRESS.length - 1));
      setCompletedSteps((step) => Math.min(step + 1, PROGRESS.length - 2));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [running]);

  function toggleInclude(key: IncludeKey) {
    setInclude((current) => ({ ...current, [key]: !current[key] }));
  }

  async function generate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setReport(null);
    setActiveStep(0);
    setCompletedSteps(0);

    try {
      const res = await fetch("/api/reports/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ticker,
          options: { depth, periodYears, include, peers: selectedPeers },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Report generation failed (${res.status})`);
      setCompletedSteps(PROGRESS.length);
      setActiveStep(PROGRESS.length - 1);
      setReport(data.result);
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

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} className={triggerClassName} onClick={() => setOpen(true)}>
        <FileText className="h-3.5 w-3.5" />
        {label}
      </Button>
      <Dialog open={open} onClose={() => (running ? cancel() : setOpen(false))} title={`Generate ${ticker} research report`} className="sm:max-w-2xl">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">{ticker}{companyName ? ` · ${companyName}` : ""}</p>
            <p className="mt-1 text-xs text-muted-foreground">Data is refreshed from providers before the report is written.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold">Report depth</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={depth === "full"} onChange={() => setDepth("full")} />
                Full research report
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={depth === "brief"} onChange={() => setDepth("brief")} />
                Concise investment brief
              </label>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold">Analysis period</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={periodYears === 5} onChange={() => setPeriodYears(5)} />
                5 years
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={periodYears === 3} onChange={() => setPeriodYears(3)} />
                3 years
              </label>
            </fieldset>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold">Include</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {INCLUDE_LABELS.map((item) => (
                <label key={item.key} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm">
                  <input type="checkbox" checked={include[item.key]} onChange={() => toggleInclude(item.key)} />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>

          <details open={advancedOpen} onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}>
            <summary className="cursor-pointer text-xs font-semibold">Advanced options</summary>
            <div className="mt-3 space-y-1.5">
              <label htmlFor={`report-peers-${ticker}`} className="text-xs font-medium">Compare with</label>
              <input
                id={`report-peers-${ticker}`}
                value={peerText}
                onChange={(event) => setPeerText(event.target.value.toUpperCase())}
                placeholder="UBL, BAFL, MCB"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </details>

          {running && (
            <div className="rounded-md border border-border bg-muted/25 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Generating {ticker} report</p>
                <Button variant="ghost" size="sm" onClick={cancel}>
                  Cancel
                </Button>
              </div>
              <div className="space-y-1.5">
                {PROGRESS.map((step, index) => {
                  const done = index < completedSteps;
                  const active = index === activeStep && !done;
                  return (
                    <div key={step} className={cn("flex items-center gap-2 text-xs", !done && !active && "text-muted-foreground")}>
                      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-3.5 w-3.5 rounded-full border border-border" />}
                      {step}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}

          {report && (
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{report.title}</p>
                  <p className="text-[11px] text-muted-foreground">Saved {report.created_at.slice(0, 16).replace("T", " ")}</p>
                </div>
                <a
                  href={`/api/reports/company/${report.id}/pdf`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                  PDF
                </a>
              </div>
              <div className="max-h-80 overflow-y-auto p-3">
                <Markdown content={report.content} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={running}>
              Close
            </Button>
            <Button onClick={generate} disabled={running}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Generate report
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
