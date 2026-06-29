"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerateReportDialog } from "@/components/stock/generate-report-dialog";
import { Loader2, Sparkles } from "lucide-react";

const ACTIONS = [
  { action: "summarize_company", label: "Summarize this company" },
  { action: "summarize_earnings", label: "Summarize latest earnings" },
  { action: "explain_trends", label: "Explain key trends" },
  { action: "find_risks", label: "Identify risks" },
  { action: "explain_ratios", label: "Explain valuation ratios" },
  { action: "explain_technicals", label: "Explain technical picture" },
  { action: "compare_portfolio", label: "Compare with my portfolio" },
  { action: "research_questions", label: "Questions to research" },
] as const;

export function CompanyAiActions({ ticker }: { ticker: string }) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; content: string } | null>(null);

  async function run(action: string) {
    setRunning(action);
    setError(null);
    try {
      const res = await fetch("/api/ai/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI action failed");
      setResult(data.result);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI action failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <GenerateReportDialog ticker={ticker} label="Generate full company report" triggerVariant="default" triggerSize="sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button key={a.action} variant="outline" size="sm" disabled={running !== null} onClick={() => run(a.action)}>
            {running === a.action ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {a.label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Research support only, grounded in the data shown on this page. Outputs never recommend buying or selling and never
        invent missing numbers. The result appears below.
      </p>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {running && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating — grounding in available data…
        </p>
      )}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>{result.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown content={result.content} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
