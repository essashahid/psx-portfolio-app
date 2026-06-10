"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Thesis } from "@/lib/types";
import { Loader2 } from "lucide-react";

const FIELDS: { key: keyof Thesis; label: string; placeholder: string }[] = [
  { key: "why_bought", label: "Why I bought this stock", placeholder: "The core reason this position exists…" },
  { key: "expectation", label: "What I expect to happen", placeholder: "Earnings growth, re-rating, dividend stream…" },
  { key: "key_risks", label: "Key risks", placeholder: "What could break this thesis…" },
  { key: "sell_conditions", label: "What would make me sell or reduce", placeholder: "Concrete conditions, not feelings…" },
  { key: "add_conditions", label: "What would make me add more", placeholder: "Conditions under which adding makes sense…" },
];

export function ThesisForm({ ticker, thesis }: { ticker: string; thesis: Thesis | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    why_bought: thesis?.why_bought ?? "",
    expectation: thesis?.expectation ?? "",
    time_horizon: thesis?.time_horizon ?? "",
    key_risks: thesis?.key_risks ?? "",
    sell_conditions: thesis?.sell_conditions ?? "",
    add_conditions: thesis?.add_conditions ?? "",
    confidence: thesis?.confidence?.toString() ?? "3",
    status: thesis?.status ?? "Active",
    review_date: thesis?.review_date ?? "",
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
    const { error } = await supabase.from("theses").upsert(
      {
        user_id: user.id,
        ticker,
        why_bought: form.why_bought || null,
        expectation: form.expectation || null,
        time_horizon: form.time_horizon || null,
        key_risks: form.key_risks || null,
        sell_conditions: form.sell_conditions || null,
        add_conditions: form.add_conditions || null,
        confidence: parseInt(form.confidence, 10),
        status: form.status,
        review_date: form.review_date || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,ticker" }
    );
    setBusy(false);
    if (error) setMsg(`Error: ${error.message}`);
    else {
      setMsg("Thesis saved.");
      // refresh alerts so a missing-thesis alert resolves immediately
      fetch("/api/alerts/refresh", { method: "POST" }).finally(() => router.refresh());
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label>{f.label}</Label>
          <Textarea
            rows={2}
            value={form[f.key as keyof typeof form] as string}
            placeholder={f.placeholder}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
          />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Time horizon</Label>
          <Input value={form.time_horizon} placeholder="e.g. 3-5 years" onChange={(e) => setForm({ ...form, time_horizon: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Confidence (1-5)</Label>
          <Select value={form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Thesis["status"] })}>
            {["Active", "Watch", "Weakening", "Broken", "Closed"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Next review date</Label>
          <Input type="date" value={form.review_date} onChange={(e) => setForm({ ...form, review_date: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save thesis
        </Button>
        {msg && <p className={`text-xs ${msg.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>{msg}</p>}
      </div>
    </form>
  );
}
