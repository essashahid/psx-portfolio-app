"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";

interface ProbeResult {
  provider: string;
  symbol: string | null;
  quote: boolean;
  history: boolean;
  error?: string;
}

export function CoverageProbe() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/engine/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Probe failed");
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Probe failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="Ticker, e.g. MEBL"
          className="h-9 w-40 rounded-md border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <Button onClick={run} disabled={loading || !ticker.trim()} size="sm">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Test coverage
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {results && (
        <div className="space-y-1.5">
          {results.map((r) => (
            <div key={r.provider} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <span className="w-32 text-xs font-medium">{r.provider}</span>
              <Badge variant={r.quote ? "green" : "secondary"}>quote {r.quote ? "✓" : "✗"}</Badge>
              <Badge variant={r.history ? "green" : "secondary"}>history {r.history ? "✓" : "✗"}</Badge>
              {r.symbol && <span className="text-[11px] text-muted-foreground">symbol: {r.symbol}</span>}
              {r.error && <span className="text-[11px] text-red-600">{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
