"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2 } from "lucide-react";

/**
 * Dismisses a dashboard check by stamping its id into profiles.prefs. The check
 * stays hidden for 14 days or until the underlying fact changes (the id encodes
 * the fact), so acknowledging a check stops it nagging without hiding it forever.
 */
export function DismissCheckButton({ checkId }: { checkId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function dismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      // Read-merge-write is handled server-side; we send the single new entry.
      await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed_checks: { [checkId]: new Date().toISOString() } }),
      });
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={dismiss}
      aria-label="Dismiss check"
      title="Dismiss"
      className="ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
    </button>
  );
}
