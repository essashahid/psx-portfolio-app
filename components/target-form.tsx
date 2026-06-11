"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Target } from "@/lib/types";
import { Loader2 } from "lucide-react";

export function TargetForm({ ticker, target }: { ticker: string; target: Target | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    target_price: target?.target_price?.toString() ?? "",
    target_allocation: target?.target_allocation?.toString() ?? "",
    review_level: target?.review_level?.toString() ?? "",
    notes: target?.notes ?? "",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("targets").upsert(
      {
        user_id: user.id,
        ticker,
        target_price: form.target_price ? parseFloat(form.target_price) : null,
        target_allocation: form.target_allocation ? parseFloat(form.target_allocation) : null,
        review_level: form.review_level ? parseFloat(form.review_level) : null,
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,ticker" }
    );
    setBusy(false);
    if (error) setMsg(`Error: ${error.message}`);
    else {
      setMsg("Targets saved.");
      fetch("/api/alerts/refresh", { method: "POST" }).finally(() => router.refresh());
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Target price (PKR)</Label>
          <Input type="number" step="any" min="0" value={form.target_price} onChange={(e) => setForm({ ...form, target_price: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Target allocation (%)</Label>
          <Input type="number" step="any" min="0" max="100" value={form.target_allocation} onChange={(e) => setForm({ ...form, target_allocation: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Review level (PKR)</Label>
          <Input
            type="number"
            step="any"
            min="0"
            value={form.review_level}
            onChange={(e) => setForm({ ...form, review_level: e.target.value })}
            title="A price at/below which this position needs review"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Input value={form.notes} placeholder="Why these levels…" onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save targets
        </Button>
        {msg && <p className={`text-xs ${msg.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>{msg}</p>}
      </div>
    </form>
  );
}
