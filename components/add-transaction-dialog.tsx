"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";

export function AddTransactionDialog({ defaultTicker }: { defaultTicker?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    ticker: defaultTicker ?? "",
    trade_date: new Date().toISOString().slice(0, 10),
    type: "BUY",
    quantity: "",
    price: "",
    commission: "",
    tax: "",
    net_amount: "",
    notes: "",
  });

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        ticker: form.ticker.toUpperCase().trim(),
        trade_date: form.trade_date,
        type: form.type,
        notes: form.notes || undefined,
      };
      if (form.quantity) body.quantity = parseFloat(form.quantity);
      if (form.price) body.price = parseFloat(form.price);
      if (form.commission) body.commission = parseFloat(form.commission);
      if (form.tax) body.tax = parseFloat(form.tax);
      if (form.net_amount) body.net_amount = parseFloat(form.net_amount);
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const isDividend = form.type === "DIVIDEND";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add transaction / dividend
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add manual transaction">
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Ticker</Label>
              <Input required value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="MEBL" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.type} onChange={(e) => set("type", e.target.value)}>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
                <option value="DIVIDEND">Dividend</option>
                <option value="BONUS">Bonus shares</option>
                <option value="RIGHT">Right shares</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" required value={form.trade_date} onChange={(e) => set("trade_date", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{isDividend ? "Shares (optional)" : "Quantity"}</Label>
              <Input type="number" step="any" min="0" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{isDividend ? "Dividend per share (optional)" : "Price per share"}</Label>
              <Input type="number" step="any" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{isDividend ? "Net dividend amount" : "Net amount (optional)"}</Label>
              <Input type="number" step="any" value={form.net_amount} onChange={(e) => set("net_amount", e.target.value)} />
            </div>
            {!isDividend && (
              <>
                <div className="space-y-1.5">
                  <Label>Commission (optional)</Label>
                  <Input type="number" step="any" min="0" value={form.commission} onChange={(e) => set("commission", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tax (optional)</Label>
                  <Input type="number" step="any" min="0" value={form.tax} onChange={(e) => set("tax", e.target.value)} />
                </div>
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. bought on results dip" />
          </div>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
