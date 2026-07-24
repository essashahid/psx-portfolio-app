"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type Txn = {
  id: string;
  trade_date: string | null;
  type: string;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  commission?: number | null;
  tax?: number | null;
  net_amount: number | null;
  notes: string | null;
};

type Cash = {
  id: string;
  movement_date: string | null;
  type: string;
  amount: number;
  description: string | null;
};

type Initial =
  | { kind: "trade"; transaction: Txn }
  | { kind: "cash"; cash: Cash };

const defaultDate = () => new Date().toISOString().slice(0, 10);

function initialForm(initial?: Initial) {
  if (initial?.kind === "trade") {
    const t = initial.transaction;
    return {
      date: t.trade_date ?? defaultDate(),
      ticker: t.ticker ?? "",
      txnType: t.type,
      cashType: "CASH_IN",
      quantity: t.quantity !== null && t.quantity !== undefined ? String(t.quantity) : "",
      price: t.price !== null && t.price !== undefined ? String(t.price) : "",
      commission: t.commission !== null && t.commission !== undefined ? String(t.commission) : "",
      tax: t.tax !== null && t.tax !== undefined ? String(t.tax) : "",
      netAmount: t.net_amount !== null && t.net_amount !== undefined ? String(t.net_amount) : "",
      amount: "",
      description: t.notes ?? "",
    };
  }

  if (initial?.kind === "cash") {
    const c = initial.cash;
    return {
      date: c.movement_date ?? defaultDate(),
      ticker: "",
      txnType: "BUY",
      cashType: c.type,
      quantity: "",
      price: "",
      commission: "",
      tax: "",
      netAmount: "",
      amount: String(c.amount),
      description: c.description ?? "",
    };
  }

  return {
    date: defaultDate(),
    ticker: "",
    txnType: "BUY",
    cashType: "CASH_IN",
    quantity: "",
    price: "",
    commission: "",
    tax: "",
    netAmount: "",
    amount: "",
    description: "",
  };
}

export function AddLedgerEntryDialog({
  initial,
  label,
  variant = "outline",
}: {
  initial?: Initial;
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const router = useRouter();
  const isEdit = !!initial;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"trade" | "cash">(initial?.kind ?? "trade");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => initialForm(initial));

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const endpoint = initial
        ? initial.kind === "trade"
          ? `/api/transactions/${initial.transaction.id}`
          : `/api/cash-movements/${initial.cash.id}`
        : mode === "trade"
          ? "/api/transactions"
          : "/api/cash-movements";
      const body: Record<string, unknown> =
        mode === "trade"
          ? {
              trade_date: form.date,
              ticker: form.ticker.toUpperCase().trim(),
              type: form.txnType,
              notes: form.description || undefined,
            }
          : {
              movement_date: form.date,
              type: form.cashType,
              amount: Number(form.amount),
              description: form.description || undefined,
            };
      if (mode === "trade") {
        if (form.quantity) body.quantity = Number(form.quantity);
        if (form.price) body.price = Number(form.price);
        if (form.commission) body.commission = Number(form.commission);
        if (form.tax) body.tax = Number(form.tax);
        if (form.netAmount) body.net_amount = Number(form.netAmount);
      }
      const res = await fetch(endpoint, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save ledger entry");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save ledger entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        {isEdit ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        {label ?? (isEdit ? "Edit" : "Add entry")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={isEdit ? "Edit ledger entry" : "Add ledger entry"}>
        <form onSubmit={submit} className="space-y-3">
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2 rounded-md bg-muted p-1">
              <Button type="button" variant={mode === "trade" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("trade")}>Trade</Button>
              <Button type="button" variant={mode === "cash" ? "secondary" : "ghost"} size="sm" onClick={() => setMode("cash")}>Raast deposit</Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>

            {mode === "trade" ? (
              <>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.txnType} onChange={(e) => set("txnType", e.target.value)}>
                    <option value="BUY">Buy</option>
                    <option value="SELL">Sell</option>
                    <option value="BONUS">Bonus</option>
                    <option value="RIGHT">Right</option>
                    <option value="SPLIT">Split</option>
                    <option value="ADJUST">Adjust</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Ticker</Label>
                  <Input required value={form.ticker} onChange={(e) => set("ticker", e.target.value.toUpperCase())} placeholder="MEBL" />
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input type="number" step="any" required value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Price</Label>
                  <Input type="number" step="any" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Net amount</Label>
                  <Input type="number" step="any" value={form.netAmount} onChange={(e) => set("netAmount", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Commission</Label>
                  <Input type="number" step="any" min="0" value={form.commission} onChange={(e) => set("commission", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tax / CDC</Label>
                  <Input type="number" step="any" min="0" value={form.tax} onChange={(e) => set("tax", e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={form.cashType} onChange={(e) => set("cashType", e.target.value)}>
                    <option value="CASH_IN">Deposit</option>
                    <option value="CASH_OUT">Withdrawal</option>
                    <option value="FEE">Fee</option>
                    <option value="TAX">Tax</option>
                    <option value="DIVIDEND">Dividend cash</option>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Amount</Label>
                  <Input type="number" step="any" min="0" required value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>{mode === "trade" ? "Notes" : "Method / description"}</Label>
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder={mode === "cash" ? "Raast, online transfer" : ""} />
          </div>

          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
