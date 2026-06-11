"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

const ENTRY_TYPES = [
  { value: "buy_decision", label: "Buy decision" },
  { value: "sell_decision", label: "Sell decision" },
  { value: "hold_review", label: "Hold / review" },
  { value: "news_reaction", label: "News reaction" },
  { value: "result_review", label: "Result review" },
  { value: "dividend_review", label: "Dividend review" },
  { value: "general_note", label: "General note" },
];

export function JournalForm({ tickers, defaultTicker }: { tickers: string[]; defaultTicker?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    ticker: defaultTicker ?? "",
    entry_date: new Date().toISOString().slice(0, 10),
    entry_type: "general_note",
    title: "",
    body: "",
    expected_outcome: "",
    risk: "",
    confidence: "3",
    follow_up_date: "",
    outcome: "",
    lessons: "",
  });

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("journal_entries").insert({
      user_id: user.id,
      ticker: form.ticker || null,
      entry_date: form.entry_date,
      entry_type: form.entry_type,
      title: form.title,
      body: form.body || null,
      expected_outcome: form.expected_outcome || null,
      risk: form.risk || null,
      confidence: parseInt(form.confidence, 10),
      follow_up_date: form.follow_up_date || null,
      outcome: form.outcome || null,
      lessons: form.lessons || null,
      source: "manual",
    });
    setBusy(false);
    if (error) setMsg(`Error: ${error.message}`);
    else {
      setMsg("Entry saved.");
      setForm({ ...form, title: "", body: "", expected_outcome: "", risk: "", outcome: "", lessons: "" });
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New journal entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" required value={form.entry_date} onChange={(e) => set("entry_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Ticker (optional)</Label>
              <Select value={form.ticker} onChange={(e) => set("ticker", e.target.value)}>
                <option value="">— portfolio-level —</option>
                {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Entry type</Label>
              <Select value={form.entry_type} onChange={(e) => set("entry_type", e.target.value)}>
                {ENTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Confidence (1-5)</Label>
              <Select value={form.confidence} onChange={(e) => set("confidence", e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input required value={form.title} placeholder="One-line summary of the decision or note" onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Details</Label>
            <Textarea rows={3} value={form.body} placeholder="What happened, what you decided, and why…" onChange={(e) => set("body", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Expected outcome</Label>
              <Input value={form.expected_outcome} onChange={(e) => set("expected_outcome", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Risk</Label>
              <Input value={form.risk} onChange={(e) => set("risk", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Follow-up date (optional)</Label>
              <Input type="date" value={form.follow_up_date} onChange={(e) => set("follow_up_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Outcome (fill in later)</Label>
              <Input value={form.outcome} onChange={(e) => set("outcome", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Lessons learned (fill in later)</Label>
            <Input value={form.lessons} onChange={(e) => set("lessons", e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save entry
            </Button>
            {msg && <p className={`text-xs ${msg.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>{msg}</p>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
