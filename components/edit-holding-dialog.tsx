"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog } from "@/components/ui/dialog";
import type { EnrichedHolding } from "@/lib/types";

export function EditHoldingDialog({ holding }: { holding: EnrichedHolding }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(String(holding.quantity));
  const [avgCost, setAvgCost] = useState(String(holding.avg_cost));
  const [notes, setNotes] = useState(holding.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/holdings/${holding.ticker}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: parseFloat(quantity),
          avg_cost: parseFloat(avgCost),
          notes: notes || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${holding.ticker} and all its transactions, thesis, targets, alerts and news? This cannot be undone.`)) return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/holdings/${holding.ticker}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Edit holding"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={`Edit ${holding.ticker}`} className="max-w-sm">
        <p className="mb-3 text-xs text-muted-foreground">
          {holding.company_name ?? holding.ticker} — manual overrides apply immediately.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qty">Quantity</Label>
            <Input
              id="qty"
              type="number"
              min="0"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cost">Avg cost (PKR per share)</Label>
            <Input
              id="cost"
              type="number"
              min="0"
              step="0.01"
              value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="e.g. Bought via rights issue"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {err && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{err}</p>}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="destructive"
            size="sm"
            onClick={remove}
            disabled={deleting || saving}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete holding
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving || deleting}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
