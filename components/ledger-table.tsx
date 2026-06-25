"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import type { LedgerCashInput, LedgerRow, LedgerTxnInput } from "@/lib/engine/ledger-view";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AddLedgerEntryDialog } from "@/components/add-ledger-entry-dialog";

type Txn = LedgerTxnInput & {
  commission?: number | null;
  tax?: number | null;
};

export function LedgerTable({
  rows,
  transactions,
  cashMovements,
}: {
  rows: LedgerRow[];
  transactions: Txn[];
  cashMovements: LedgerCashInput[];
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const txnsById = new Map(transactions.map((t) => [t.id, t]));
  const cashById = new Map(cashMovements.map((c) => [c.id, c]));

  async function remove(row: LedgerRow) {
    const ok = window.confirm("Delete this ledger entry and recompute the portfolio?");
    if (!ok) return;
    setDeleting(`${row.refType}:${row.id}`);
    try {
      const endpoint =
        row.refType === "transaction"
          ? `/api/transactions/${row.id}`
          : `/api/cash-movements/${row.id}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="border-t border-border pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Virtual ledger</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Editable cash and trade ledger. Holdings, dashboard, benchmark and alerts are derived from these rows.
          </p>
        </div>
        <AddLedgerEntryDialog variant="default" label="Add entry" />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">Date</th>
              <th className="px-2 py-2">Narration</th>
              <th className="px-2 py-2">Ticker</th>
              <th className="px-2 py-2 text-right">Debit</th>
              <th className="px-2 py-2 text-right">Credit</th>
              <th className="px-2 py-2 text-right">Balance</th>
              <th className="px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.refType}:${row.id}`;
              const deletingRow = deleting === key;
              const txn = row.refType === "transaction" ? txnsById.get(row.id) : null;
              const cash = row.refType === "cash_movement" ? cashById.get(row.id) : null;
              return (
                <tr key={key} className="border-b border-border last:border-0 align-middle">
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">{row.date ?? "—"}</td>
                  <td className="px-2 py-2 font-medium">{row.narration}</td>
                  <td className="px-2 py-2 text-muted-foreground">{row.ticker ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-red-700">{row.debit ? formatMoney(row.debit) : "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{row.credit ? formatMoney(row.credit) : "—"}</td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">{formatMoney(row.balance)}</td>
                  <td className="px-2 py-2">
                    <div className="flex justify-end gap-1.5">
                      {txn && <AddLedgerEntryDialog initial={{ kind: "trade", transaction: txn }} label="Edit" variant="ghost" />}
                      {cash && <AddLedgerEntryDialog initial={{ kind: "cash", cash }} label="Edit" variant="ghost" />}
                      <Button variant="ghost" size="sm" onClick={() => remove(row)} disabled={deletingRow} aria-label="Delete ledger entry">
                        {deletingRow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
