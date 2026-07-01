"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewsRefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/news/refresh", { method: "POST", headers: { "Content-Type": "application/json" } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Refresh failed (${res.status})`);
      const inserted = Number(data.inserted ?? 0);
      setMessage(inserted > 0 ? `${inserted} new event${inserted === 1 ? "" : "s"} available` : "No new events found");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={refresh} disabled={loading} variant="outline" size="sm" className="gap-1.5">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {loading ? "Checking sources..." : "Refresh"}
      </Button>
      {(message || error) && (
        <span className={`text-[11px] ${error ? "text-red-600" : "text-muted-foreground"}`}>
          {error ?? message}
        </span>
      )}
    </div>
  );
}
