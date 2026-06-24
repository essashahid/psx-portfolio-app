"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { Dividend, EnrichedHolding } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { Edit2, Loader2, Plus, Trash2 } from "lucide-react";

type DividendFormState = {
  id?: string;
  ticker: string;
  company_name: string;
  announcement_date: string;
  ex_date: string;
  payment_date: string;
  dividend_per_share: string;
  quantity_held: string;
  amount: string;
  tax: string;
  net_amount: string;
  status: Dividend["status"];
  notes: string;
};

const blank: DividendFormState = {
  ticker: "",
  company_name: "",
  announcement_date: "",
  ex_date: "",
  payment_date: "",
  dividend_per_share: "",
  quantity_held: "",
  amount: "",
  tax: "",
  net_amount: "",
  status: "received",
  notes: "",
};

export function DividendManager({
  dividends,
  holdings,
  triggerOnly = false,
}: {
  dividends: Dividend[];
  holdings: EnrichedHolding[];
  triggerOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DividendFormState>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const holdingMap = useMemo(() => new Map(holdings.map((h) => [h.ticker, h])), [holdings]);

  function set(key: keyof DividendFormState, value: string) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "ticker") {
        const h = holdingMap.get(value.toUpperCase());
        if (h) {
          next.company_name = h.company_name ?? "";
          next.quantity_held = String(h.quantity);
        }
      }
      if (key === "dividend_per_share" || key === "quantity_held") {
        const dps = parseFloat(key === "dividend_per_share" ? value : next.dividend_per_share);
        const qty = parseFloat(key === "quantity_held" ? value : next.quantity_held);
        if (Number.isFinite(dps) && Number.isFinite(qty)) {
          next.amount = String(round2(dps * qty));
          const tax = parseFloat(next.tax || "0");
          if (Number.isFinite(tax)) next.net_amount = String(round2(dps * qty - tax));
        }
      }
      if (key === "amount" || key === "tax") {
        const gross = parseFloat(key === "amount" ? value : next.amount);
        const tax = parseFloat(key === "tax" ? value : next.tax || "0");
        if (Number.isFinite(gross) && Number.isFinite(tax)) next.net_amount = String(round2(gross - tax));
      }
      return next;
    });
  }

  function openNew() {
    setForm(blank);
    setError(null);
    setOpen(true);
  }

  function openEdit(d: Dividend) {
    setForm({
      id: d.id,
      ticker: d.ticker ?? "",
      company_name: d.company_name ?? "",
      announcement_date: d.announcement_date ?? "",
      ex_date: d.ex_date ?? "",
      payment_date: d.payment_date ?? d.pay_date ?? "",
      dividend_per_share: d.dividend_per_share !== null ? String(d.dividend_per_share) : "",
      quantity_held: d.quantity_held !== null ? String(d.quantity_held) : "",
      amount: String(d.amount ?? 0),
      tax: d.tax !== null ? String(d.tax) : "",
      net_amount: d.net_amount !== null ? String(d.net_amount) : "",
      status: d.status,
      notes: d.notes ?? "",
    });
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        ticker: form.ticker.toUpperCase().trim(),
        company_name: form.company_name || undefined,
        announcement_date: form.announcement_date || undefined,
        ex_date: form.ex_date || undefined,
        payment_date: form.payment_date || undefined,
        dividend_per_share: form.dividend_per_share ? parseFloat(form.dividend_per_share) : undefined,
        quantity_held: form.quantity_held ? parseFloat(form.quantity_held) : undefined,
        amount: parseFloat(form.amount),
        tax: form.tax ? parseFloat(form.tax) : 0,
        net_amount: form.net_amount ? parseFloat(form.net_amount) : undefined,
        status: form.status,
        notes: form.notes || undefined,
      };
      if (form.id) body.id = form.id;
      const res = await fetch("/api/dividends", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this dividend record?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/dividends", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {triggerOnly ? (
        <Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5" /> Add dividend</Button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{dividends.length} dividend record(s)</p>
          <Button size="sm" onClick={openNew}><Plus className="h-3.5 w-3.5" /> Add dividend</Button>
        </div>
      )}

      {!triggerOnly && <div className="mt-3 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Ticker", "Status", "Announcement", "Payment", "DPS", "Qty", "Gross", "Tax", "Net", ""].map((h) => (
                <th key={h} className="h-9 whitespace-nowrap px-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dividends.map((d) => (
              <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <td className="px-2.5 py-2 font-medium">{d.ticker}</td>
                <td className="px-2.5 py-2"><Badge variant={statusVariant(d.status)}>{d.status}</Badge></td>
                <td className="px-2.5 py-2 text-xs text-muted-foreground">{d.announcement_date ?? "—"}</td>
                <td className="px-2.5 py-2 text-xs text-muted-foreground">{d.payment_date ?? d.pay_date ?? "—"}</td>
                <td className="px-2.5 py-2 text-xs tabular-nums">{formatNumber(d.dividend_per_share)}</td>
                <td className="px-2.5 py-2 text-xs tabular-nums">{formatNumber(d.quantity_held, 0)}</td>
                <td className="px-2.5 py-2 text-xs tabular-nums">{formatNumber(d.amount, 0)}</td>
                <td className="px-2.5 py-2 text-xs tabular-nums">{formatNumber(d.tax ?? 0, 0)}</td>
                <td className="px-2.5 py-2 text-xs font-medium tabular-nums">{formatNumber(d.net_amount ?? d.amount, 0)}</td>
                <td className="px-2.5 py-2">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => openEdit(d)} className="rounded p-1 text-muted-foreground hover:bg-muted" title="Edit dividend">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(d.id)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600" title="Delete dividend">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {dividends.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2.5 py-8 text-center text-xs text-muted-foreground">No dividend records match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>}

      <Dialog open={open} onClose={() => setOpen(false)} title={form.id ? "Edit dividend" : "Add dividend"} className="sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Ticker</Label>
              <Input required value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} list="dividend-tickers" />
              <datalist id="dividend-tickers">
                {holdings.map((h) => <option key={h.ticker} value={h.ticker}>{h.company_name ?? h.ticker}</option>)}
              </datalist>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Company</Label>
              <Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Announcement date</Label>
              <Input type="date" value={form.announcement_date} onChange={(e) => set("announcement_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Ex-date</Label>
              <Input type="date" value={form.ex_date} onChange={(e) => set("ex_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment date</Label>
              <Input type="date" value={form.payment_date} onChange={(e) => set("payment_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Dividend/share</Label>
              <Input type="number" step="any" min="0" value={form.dividend_per_share} onChange={(e) => set("dividend_per_share", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Quantity held</Label>
              <Input type="number" step="any" min="0" value={form.quantity_held} onChange={(e) => set("quantity_held", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Dividend["status"] }))}>
                <option value="announced">Announced</option>
                <option value="expected">Expected</option>
                <option value="received">Received</option>
                <option value="missing">Missing</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Gross dividend</Label>
              <Input required type="number" step="any" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Tax deducted</Label>
              <Input type="number" step="any" min="0" value={form.tax} onChange={(e) => set("tax", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Net dividend</Label>
              <Input type="number" step="any" min="0" value={form.net_amount} onChange={(e) => set("net_amount", e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" />
            </div>
          </div>
          {error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save dividend
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function statusVariant(status: Dividend["status"]): "green" | "red" | "amber" | "blue" {
  if (status === "received") return "green";
  if (status === "missing") return "red";
  if (status === "expected") return "amber";
  return "blue";
}
