"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Globe2 } from "lucide-react";

/**
 * Manual FIPI / LIPI entry. Auto-fetch handles the normal daily flow; this
 * remains the override/backfill path when a source is late or needs correction.
 */
export function ForeignFlowsForm({ lastDate, autoConfigured }: { lastDate: string | null; autoConfigured: boolean }) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const [form, setForm] = useState({
    date: today,
    currency: "USD",
    fipiNet: "",
    fipiBuy: "",
    fipiSell: "",
    sectorsText: "",
    participantsText: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/flows/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMsg({ text: `Saved ${data.date}: net ${data.fipiNet ?? "—"}, ${data.sectors} sector(s), ${data.participants} participant(s).`, error: false });
      router.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Failed", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        <Globe2 className="mr-1 inline h-3.5 w-3.5" />
        {autoConfigured
          ? "Auto-fetch is enabled. You can still override or backfill any day here."
          : "Paste the day's NCCPL FIPI/LIPI numbers below. Figures are net USD millions; positive = net foreign buying."}
        {lastDate ? ` Latest on record: ${lastDate}.` : ""}
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>FIPI net</Label>
          <Input type="text" inputMode="decimal" placeholder="e.g. 12.4 or -3.1" value={form.fipiNet} onChange={(e) => setForm((f) => ({ ...f, fipiNet: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Gross buy (optional)</Label>
          <Input type="text" inputMode="decimal" value={form.fipiBuy} onChange={(e) => setForm((f) => ({ ...f, fipiBuy: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Gross sell (optional)</Label>
          <Input type="text" inputMode="decimal" value={form.fipiSell} onChange={(e) => setForm((f) => ({ ...f, fipiSell: e.target.value }))} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Sectors — one per line, &ldquo;Sector, net&rdquo;</Label>
          <Textarea
            rows={7}
            className="font-mono text-[12px]"
            placeholder={"Commercial Banks, 5.2\nCement, -2.1\nOil & Gas Exploration, 3.4\nFertilizer, -0.8"}
            value={form.sectorsText}
            onChange={(e) => setForm((f) => ({ ...f, sectorsText: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Local investors (LIPI) — optional, &ldquo;Category, net&rdquo;</Label>
          <Textarea
            rows={7}
            className="font-mono text-[12px]"
            placeholder={"Individuals, -8.0\nMutual Funds, 4.5\nBanks/DFI, 1.2\nInsurance, 2.3"}
            value={form.participantsText}
            onChange={(e) => setForm((f) => ({ ...f, participantsText: e.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Note (optional)</Label>
        <Input placeholder="e.g. source: NCCPL daily report" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save flows
        </Button>
        {msg && <span className={`text-[11px] ${msg.error ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
