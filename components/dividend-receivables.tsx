"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import type { DividendEvent } from "@/lib/dividends/engine";
import type { Dividend } from "@/lib/types";
import { formatNumber, cn } from "@/lib/utils";
import { CheckCircle2, EyeOff, Loader2, Pencil } from "lucide-react";

type Tab = "confirmed" | "forecasted" | "received";

const fmt = (n: number | null | undefined, dp = 0) => (n === null || n === undefined ? "—" : formatNumber(n, dp));
const dateOrDash = (d: string | null) => d ?? "—";

function confidenceBadge(level: string) {
  return level === "high" ? "green" : level === "medium" ? "amber" : "red";
}

function eligibilityLabel(s: string) {
  return s.replace(/_/g, " ");
}

export function DividendReceivables({
  events,
  received,
  showLowConfidence,
}: {
  events: DividendEvent[];
  received: Dividend[];
  showLowConfidence: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("confirmed");
  const [showHidden, setShowHidden] = useState(showLowConfidence);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [qtyDialog, setQtyDialog] = useState<DividendEvent | null>(null);
  const [qtyValue, setQtyValue] = useState("");
  const [receiveDialog, setReceiveDialog] = useState<DividendEvent | null>(null);
  const [receiveForm, setReceiveForm] = useState({ date: "", gross: "", tax: "" });

  const confirmed = useMemo(
    () =>
      events.filter(
        (e) =>
          !e.is_forecast &&
          ["announced", "expected", "overdue", "needs_review"].includes(e.status) &&
          (showHidden || e.confidence_level !== "low")
      ),
    [events, showHidden]
  );
  const hiddenCount = useMemo(
    () =>
      events.filter(
        (e) => !e.is_forecast && ["announced", "expected", "overdue", "needs_review"].includes(e.status) && e.confidence_level === "low"
      ).length,
    [events]
  );
  const forecasts = useMemo(() => events.filter((e) => e.is_forecast && e.status === "forecasted"), [events]);
  const receivedEvents = useMemo(() => events.filter((e) => e.status === "received"), [events]);

  async function act(id: string, body: Record<string, unknown>, done?: () => void) {
    setBusyId(id);
    setMsg(null);
    try {
      const res = await fetch("/api/dividends/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      setMsg(data.message ?? "Done.");
      done?.();
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "confirmed", label: "Confirmed", count: confirmed.length },
    { key: "forecasted", label: "Forecasted", count: forecasts.length },
    { key: "received", label: "Received", count: received.length + receivedEvents.length },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                tab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
        {tab === "confirmed" && hiddenCount > 0 && (
          <button
            onClick={() => setShowHidden((s) => !s)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <EyeOff className="h-3 w-3" />
            {showHidden ? "Hide" : "Show"} {hiddenCount} low-confidence match(es)
          </button>
        )}
      </div>

      {msg && <p className="rounded-md bg-muted px-3 py-1.5 text-[11px]">{msg}</p>}

      {tab === "confirmed" && (
        <div className="space-y-2.5">
          {confirmed.length === 0 && (
            <p className="rounded-lg border border-border bg-card py-8 text-center text-xs text-muted-foreground">
              No confirmed dividend announcements matched to your holdings. Click “Check upcoming dividends” to scan PSX announcements.
            </p>
          )}
          {confirmed.map((e) => (
            <div key={e.id} className="rounded-lg border border-border bg-card p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/stocks/${e.ticker}`} className="text-sm font-semibold hover:underline">{e.ticker}</Link>
                    <Badge variant={e.status === "overdue" ? "red" : e.status === "needs_review" ? "amber" : "green"}>
                      {e.status.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant={confidenceBadge(e.confidence_level)}>{e.confidence_level} confidence</Badge>
                    <Badge variant="default">{e.dividend_type}</Badge>
                    {e.event_type === "credit" && <Badge variant="secondary">already credited</Badge>}
                    {e.is_possible_duplicate && <Badge variant="amber">possible duplicate</Badge>}
                    {e.needs_tax_review && <Badge variant="amber">needs tax review</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.company_name ?? e.ticker}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    {e.net_expected !== null ? `Net ~PKR ${fmt(e.net_expected)}` : "Net: needs data"}
                  </p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    gross {fmt(e.gross_expected)} − tax {fmt(e.estimated_tax)}
                    {e.tax_rate !== null ? ` @ ${(e.tax_rate * 100).toFixed(0)}% ${e.taxpayer_status ?? "filer"}` : ""}
                  </p>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-4">
                <span>Announced: {dateOrDash(e.announcement_date)}</span>
                <span>Ex-date: {dateOrDash(e.ex_date)}</span>
                <span>
                  Payment: {e.payment_date ?? (e.estimated_payment_start ? `est. ${e.estimated_payment_start} → ${e.estimated_payment_end}` : "—")}
                </span>
                <span>
                  DPS: {fmt(e.dividend_per_share, 2)}
                  {e.dividend_percentage !== null ? ` (${e.dividend_percentage}%${e.face_value !== null ? ` of FV ${e.face_value}` : ""})` : ""}
                </span>
                <span>Qty held: {fmt(e.eligible_quantity)}</span>
                <span className={cn(e.eligibility_status === "needs_confirmation" && "text-amber-600")}>
                  Eligibility: {eligibilityLabel(e.eligibility_status)}
                </span>
                <span>
                  Source: {e.source_url ? (
                    <a href={e.source_url} target="_blank" rel="noreferrer" className="underline">PSX announcement</a>
                  ) : (e.source_type ?? "—")} ({e.source_quality})
                </span>
                <span>Checked: {e.last_checked_at?.slice(0, 10) ?? "—"}</span>
              </div>

              {(e.notes || e.eligibility_notes || !e.tax_rate_configured) && (
                <div className="mt-2 space-y-1">
                  {!e.tax_rate_configured && (
                    <p className="text-[11px] text-amber-600">Dividend tax rate is not configured. Net dividend is only a rough estimate.</p>
                  )}
                  {e.notes && <p className="text-[11px] text-amber-600">{e.notes}</p>}
                  {e.eligibility_notes && e.eligibility_status !== "eligible" && (
                    <p className="text-[11px] text-muted-foreground">{e.eligibility_notes}</p>
                  )}
                </div>
              )}

              {e.is_possible_duplicate && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                  <span className="text-[11px] text-amber-700">
                    Looks like a duplicate of another event for {e.ticker} — excluded from totals to avoid double counting.
                  </span>
                  <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => act(e.id, { action: "merge_duplicate" })}>
                    Merge
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => act(e.id, { action: "keep_separate" })}>
                    Keep separate
                  </Button>
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {e.eligibility_status !== "eligible" && (
                  <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => act(e.id, { action: "confirm_eligibility" })}>
                    <CheckCircle2 className="h-3 w-3" /> Confirm eligibility
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busyId === e.id}
                  onClick={() => { setQtyDialog(e); setQtyValue(String(e.eligible_quantity ?? "")); }}>
                  <Pencil className="h-3 w-3" /> Edit eligible qty
                </Button>
                <Button size="sm" disabled={busyId === e.id}
                  onClick={() => {
                    setReceiveDialog(e);
                    setReceiveForm({
                      date: new Date().toISOString().slice(0, 10),
                      gross: e.gross_expected !== null ? String(e.gross_expected) : "",
                      tax: e.estimated_tax !== null ? String(e.estimated_tax) : "",
                    });
                  }}>
                  Mark received
                </Button>
                {e.status === "needs_review" && (
                  <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => act(e.id, { action: "confirm" })}>
                    Confirm
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => act(e.id, { action: "not_eligible" })}>
                  Not eligible
                </Button>
                <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => act(e.id, { action: "ignore" })}>
                  Ignore
                </Button>
                {busyId === e.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "forecasted" && (
        <div className="space-y-2.5">
          {forecasts.length === 0 && (
            <p className="rounded-lg border border-border bg-card py-8 text-center text-xs text-muted-foreground">
              No active forecasts. Click “Generate dividend forecasts” to project likely payouts from your dividend history.
            </p>
          )}
          {forecasts.map((e) => (
            <div key={e.id} className="rounded-lg border border-dashed border-border bg-card p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/stocks/${e.ticker}`} className="text-sm font-semibold hover:underline">{e.ticker}</Link>
                    <Badge variant="amber">Forecast only — not announced</Badge>
                    <Badge variant={confidenceBadge(e.confidence_level)}>{e.confidence_level} confidence</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{e.company_name ?? e.ticker}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    Net est. PKR {fmt(e.net_low)}–{fmt(e.net_high)}
                  </p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    gross {fmt(e.gross_low)}–{fmt(e.gross_high)}
                    {e.tax_rate !== null ? ` · ${(e.tax_rate * 100).toFixed(0)}% filer tax assumed` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-3">
                <span>Expected window: {dateOrDash(e.estimated_payment_start)} → {dateOrDash(e.estimated_payment_end)}</span>
                <span>DPS range: {e.dps_low !== null ? `${fmt(e.dps_low, 2)}–${fmt(e.dps_high, 2)}` : "from past amounts"}</span>
                <span>Qty: {fmt(e.eligible_quantity)}</span>
              </div>
              {e.forecast_basis && <p className="mt-1.5 text-[11px] text-muted-foreground">Basis: {e.forecast_basis}</p>}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => act(e.id, { action: "watch" })}>Watch</Button>
                <Button size="sm" variant="outline" disabled={busyId === e.id} onClick={() => act(e.id, { action: "confirm" })}>Convert to confirmed</Button>
                <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => act(e.id, { action: "ignore" })}>Ignore</Button>
                {busyId === e.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "received" && (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2.5 py-2">Ticker</th>
                <th className="px-2.5 py-2">Company</th>
                <th className="px-2.5 py-2">Paid</th>
                <th className="px-2.5 py-2 text-right">Gross</th>
                <th className="px-2.5 py-2 text-right">Tax</th>
                <th className="px-2.5 py-2 text-right">Net</th>
                <th className="px-2.5 py-2 text-right">Rate</th>
                <th className="px-2.5 py-2 text-right">Variance</th>
                <th className="px-2.5 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {receivedEvents.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-2.5 py-1.5 font-medium">{e.ticker}</td>
                  <td className="max-w-[180px] truncate px-2.5 py-1.5 text-muted-foreground">{e.company_name ?? "—"}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{dateOrDash(e.received_date)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(e.gross_received)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(e.tax_deducted_actual)}</td>
                  <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">{fmt(e.net_received)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{e.actual_tax_rate !== null ? `${(e.actual_tax_rate * 100).toFixed(1)}%` : "—"}</td>
                  <td className={cn("px-2.5 py-1.5 text-right tabular-nums", (e.variance_amount ?? 0) < 0 ? "text-red-600" : "text-emerald-600")}>
                    {e.variance_amount !== null ? `${e.variance_amount >= 0 ? "+" : ""}${fmt(e.variance_amount)}` : "—"}
                    {e.is_reconciled && " ✓"}
                  </td>
                  <td className="max-w-[160px] truncate px-2.5 py-1.5 text-muted-foreground">{e.notes ?? "—"}</td>
                </tr>
              ))}
              {received.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-2.5 py-1.5 font-medium">{d.ticker}</td>
                  <td className="max-w-[180px] truncate px-2.5 py-1.5 text-muted-foreground">{d.company_name ?? "—"}</td>
                  <td className="px-2.5 py-1.5 tabular-nums">{d.payment_date ?? d.pay_date ?? "—"}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(d.amount)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{fmt(d.tax)}</td>
                  <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">{fmt(d.net_amount)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">
                    {d.tax !== null && d.amount > 0 ? `${((d.tax / d.amount) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2.5 py-1.5 text-right text-muted-foreground">—</td>
                  <td className="max-w-[160px] truncate px-2.5 py-1.5 text-muted-foreground">{d.notes ?? "—"}</td>
                </tr>
              ))}
              {received.length === 0 && receivedEvents.length === 0 && (
                <tr><td colSpan={9} className="px-2.5 py-8 text-center text-muted-foreground">No received dividends recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit eligible quantity */}
      <Dialog open={qtyDialog !== null} onClose={() => setQtyDialog(null)} title={`Eligible quantity — ${qtyDialog?.ticker ?? ""}`} className="max-w-xs">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Shares held before ex-date / book closure</Label>
            <Input type="number" min="0" value={qtyValue} onChange={(e) => setQtyValue(e.target.value)} />
          </div>
          <p className="text-[11px] text-muted-foreground">Gross, tax and net expected amounts recalculate from this quantity.</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setQtyDialog(null)}>Cancel</Button>
            <Button size="sm" disabled={busyId !== null}
              onClick={() => qtyDialog && act(qtyDialog.id, { action: "set_eligible_quantity", eligible_quantity: parseFloat(qtyValue) }, () => setQtyDialog(null))}>
              Save
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Mark received */}
      <Dialog open={receiveDialog !== null} onClose={() => setReceiveDialog(null)} title={`Mark received — ${receiveDialog?.ticker ?? ""}`} className="max-w-xs">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Payment date</Label>
            <Input type="date" value={receiveForm.date} onChange={(e) => setReceiveForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Gross received (PKR)</Label>
            <Input type="number" min="0" value={receiveForm.gross} onChange={(e) => setReceiveForm((f) => ({ ...f, gross: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Tax deducted (PKR)</Label>
            <Input type="number" min="0" value={receiveForm.tax} onChange={(e) => setReceiveForm((f) => ({ ...f, tax: e.target.value }))} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            The amount is reconciled against the expected net and recorded in your dividend income.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setReceiveDialog(null)}>Cancel</Button>
            <Button size="sm" disabled={busyId !== null}
              onClick={() =>
                receiveDialog &&
                act(receiveDialog.id, {
                  action: "mark_received",
                  received_date: receiveForm.date,
                  gross_received: parseFloat(receiveForm.gross),
                  tax_deducted_actual: parseFloat(receiveForm.tax || "0"),
                }, () => setReceiveDialog(null))
              }>
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
