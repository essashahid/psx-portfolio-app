"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { TaxSettings } from "@/lib/dividends/tax";
import { Loader2 } from "lucide-react";

export function TaxProfileForm({ settings }: { settings: TaxSettings }) {
  const router = useRouter();
  const [form, setForm] = useState({
    taxpayer_status: settings.taxpayer_status,
    tax_year: settings.tax_year,
    dividend_tax_rate_pct: settings.dividend_tax_rate !== null ? String(settings.dividend_tax_rate * 100) : "",
    default_payment_window_days: String(settings.default_payment_window_days),
    default_face_value: String(settings.default_face_value),
    source_note: settings.source_note ?? "",
    show_forecasts_in_review: settings.show_forecasts_in_review,
    auto_create_confirmed: settings.auto_create_confirmed,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/tax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxpayer_status: form.taxpayer_status,
          tax_year: form.tax_year,
          dividend_tax_rate: parseFloat(form.dividend_tax_rate_pct) / 100,
          default_payment_window_days: parseInt(form.default_payment_window_days, 10),
          default_face_value: parseFloat(form.default_face_value),
          source_note: form.source_note || null,
          show_forecasts_in_review: form.show_forecasts_in_review,
          auto_create_confirmed: form.auto_create_confirmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMsg({ text: data.message ?? "Saved.", error: false });
      router.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Failed", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {!settings.configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Using default assumptions (Pakistan filer / ATL, 15% on listed cash dividends). Save to confirm or adjust them.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Taxpayer status</Label>
          <Select
            value={form.taxpayer_status}
            onChange={(e) => setForm((f) => ({ ...f, taxpayer_status: e.target.value }))}
          >
            <option value="filer">Filer / ATL</option>
            <option value="non-filer">Non-filer</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Effective tax year</Label>
          <Input value={form.tax_year} onChange={(e) => setForm((f) => ({ ...f, tax_year: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label>Dividend tax rate (%) — listed company cash dividends</Label>
          <Input
            type="number" min="0" max="100" step="0.5"
            value={form.dividend_tax_rate_pct}
            onChange={(e) => setForm((f) => ({ ...f, dividend_tax_rate_pct: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Default payment window (working days)</Label>
          <Input
            type="number" min="1" max="120"
            value={form.default_payment_window_days}
            onChange={(e) => setForm((f) => ({ ...f, default_payment_window_days: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Default face value (when company face value is unknown)</Label>
          <Input
            type="number" min="0.1" step="0.1"
            value={form.default_face_value}
            onChange={(e) => setForm((f) => ({ ...f, default_face_value: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Source / note for tax assumption</Label>
          <Input value={form.source_note} onChange={(e) => setForm((f) => ({ ...f, source_note: e.target.value }))} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.show_forecasts_in_review}
            onChange={(e) => setForm((f) => ({ ...f, show_forecasts_in_review: e.target.checked }))}
          />
          Show forecasted dividends in the Review Queue
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.auto_create_confirmed}
            onChange={(e) => setForm((f) => ({ ...f, auto_create_confirmed: e.target.checked }))}
          />
          Auto-confirm expected dividends from high-confidence official announcements
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save tax profile
        </Button>
        {settings.updated_at && (
          <span className="text-[11px] text-muted-foreground">Last updated {settings.updated_at.slice(0, 10)}</span>
        )}
        {msg && <span className={`text-[11px] ${msg.error ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
