"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Sparkles } from "lucide-react";

const ACTIONS = [
  { action: "summarize_news", label: "Summarize latest news" },
  { action: "thesis_check", label: "Check news vs my thesis" },
  { action: "find_risks", label: "Find risks" },
  { action: "review_note", label: "Generate review note" },
  { action: "compare_thesis", label: "Compare news with original thesis" },
  { action: "attention", label: "What should I watch next?" },
] as const;

export function StockAiActions({ ticker }: { ticker: string }) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; content: string } | null>(null);

  async function run(action: string) {
    setRunning(action);
    setError(null);
    try {
      const res = await fetch("/api/ai/stock", {
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
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <Button
            key={a.action}
            variant="outline"
            size="sm"
            disabled={running !== null}
            onClick={() => run(a.action)}
          >
            {running === a.action ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {a.label}
          </Button>
        ))}
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
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
