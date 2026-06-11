"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Star, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function WatchlistButton({
  ticker,
  initialWatched,
  size = "sm",
}: {
  ticker: string;
  initialWatched: boolean;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [watched, setWatched] = useState(initialWatched);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    const next = !watched;
    setWatched(next); // optimistic
    try {
      const res = await fetch("/api/stocks/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, action: "toggle" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setWatched(data.watched);
      router.refresh();
    } catch {
      setWatched(!next); // revert
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant={watched ? "secondary" : "outline"} size={size} onClick={toggle} disabled={loading}>
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Star className={cn("h-3.5 w-3.5", watched && "fill-amber-400 text-amber-500")} />
      )}
      {watched ? "Watching" : "Watchlist"}
    </Button>
  );
}
