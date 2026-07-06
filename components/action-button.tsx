"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Button that POSTs/DELETEs to an API route, shows a spinner, surfaces the
 * result message inline, and refreshes server-component data on success.
 */
export function ActionButton({
  endpoint,
  method = "POST",
  body,
  label,
  confirmText,
  onSuccessMessage,
  ...buttonProps
}: {
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  label: React.ReactNode;
  confirmText?: string;
  onSuccessMessage?: string;
} & Omit<ButtonProps, "onClick" | "children">) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setMessage({ text: onSuccessMessage ?? data.message ?? "Done.", error: false });
      router.refresh();
      // Keep spinner visible while the server component re-renders
      await new Promise<void>((r) => setTimeout(r, 600));
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Failed", error: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button onClick={run} disabled={loading} {...buttonProps}>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {label}
      </Button>
      {message && (
        <span className={`max-w-xs text-[11px] ${message.error ? "text-red-600" : "text-emerald-700"}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}
