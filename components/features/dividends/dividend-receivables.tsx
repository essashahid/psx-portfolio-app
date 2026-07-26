"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import type { DividendEvent } from "@/lib/dividends/engine";
import type { Dividend } from "@/lib/shared/types";
import { formatNumber, cn } from "@/lib/shared/format";
import { SectorDot } from "@/components/shared/sector-chip";
import { EyeOff, Loader2 } from "lucide-react";

type Tab = "upcoming" | "estimated" | "received" | "review";

const fmt = (n: number | null | undefined, dp = 0) => (n === null || n === undefined ? "—" : formatNumber(n, dp));
const dateOrDash = (d: string | null) => d ?? "—";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function eligibilityLabel(s: string) {
  return s.replace(/_/g, " ");
}

export function DividendReceivables({
  events,
  received,
  showLowConfidence,
  sectors = {},
  readOnly = false,
}: {
  events: DividendEvent[];
  received: Dividend[];
  showLowConfidence: boolean;
  /** ticker → sector, so the ledger dots carry the platform's sector colours. */
  sectors?: Record<string, string | null>;
  readOnly?: boolean;
}) {
  const sectorFor = (ticker: string | null) => (ticker ? sectors[ticker] ?? null : null);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [showHidden, setShowHidden] = useState(showLowConfidence);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [qtyDialog, setQtyDialog] = useState<DividendEvent | null>(null);
  const [qtyValue, setQtyValue] = useState("");
  const [receiveDialog, setReceiveDialog] = useState<DividendEvent | null>(null);
  const [receiveForm, setReceiveForm] = useState({ date: "", gross: "", tax: "" });
  const [expanded, setExpanded] = useState<string | null>(null);

  const upcoming = useMemo(
    () =>
      events.filter(
        (e) =>
          !e.is_forecast &&
          ["announced", "expected"].includes(e.status) &&
          !e.is_possible_duplicate &&
          !e.needs_tax_review &&
          (showHidden || e.confidence_level !== "low")
      ),
    [events, showHidden]
  );
  const hiddenCount = useMemo(
    () =>
      events.filter(
        (e) => !e.is_forecast && ["announced", "expected"].includes(e.status) && e.confidence_level === "low"
      ).length,
    [events]
  );
  const forecasts = useMemo(() => events.filter((e) => e.is_forecast && e.status === "forecasted"), [events]);
  const review = useMemo(() => events.filter((e) => e.status === "needs_review" || e.status === "overdue" || e.is_possible_duplicate || e.needs_tax_review), [events]);

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
    { key: "upcoming", label: "Upcoming", count: upcoming.length },
    { key: "estimated", label: "Estimated", count: forecasts.length },
    { key: "received", label: "Received", count: received.length },
    { key: "review", label: "Needs review", count: review.length },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Records</p>
          <h2 className="mt-1.5 font-display text-(length:--text-h1) font-normal tracking-editorial text-text-strong">
            {tabs.find((t) => t.key === tab)?.label ?? "Records"}
          </h2>
        </div>
        <div className="flex gap-5 pb-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "whitespace-nowrap border-b-2 pb-1.5 text-sm transition-colors",
                tab === t.key ? "border-indigo font-semibold text-text-strong" : "border-transparent font-medium text-text-muted hover:text-text-strong"
              )}
            >
              {t.label}
              <span className="figure ml-1.5 text-(length:--text-2xs) text-text-faint">{t.count}</span>
            </button>
          ))}
        </div>
        {tab === "upcoming" && hiddenCount > 0 && (
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

      {tab === "upcoming" && (
        <div className="ledger">
          {upcoming.length === 0 && (
            <p className="max-w-(--measure) py-6 text-sm text-text-muted">
              No upcoming dividends have been confirmed for your holdings. Check PSX announcements to refresh verified records.
            </p>
          )}
          {upcoming.map((e) => {
            const open = expanded === e.id;
            const date = e.ex_date ?? e.payment_date ?? e.estimated_payment_start;
            return (
              <div key={e.id} className="ledger-row flex flex-col gap-0">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : e.id)}
                  className="grid w-full items-center gap-4 py-1.5 text-left"
                  style={{ gridTemplateColumns: "58px minmax(0,1fr) 96px 128px 104px 18px" }}
                >
                  <span className="border-r border-rule text-center">
                    <span className="figure block text-sm font-semibold leading-tight text-text-strong">{date ? date.slice(8, 10) : "—"}</span>
                    <span className="block text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
                      {date ? MONTHS[Number(date.slice(5, 7)) - 1] : ""}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <SectorDot sector={sectorFor(e.ticker)} />
                      <span className="text-sm font-semibold text-text-strong">{e.ticker}</span>
                      <span className="truncate text-(length:--text-2xs) text-text-muted">{e.company_name ?? e.ticker}</span>
                    </span>
                  </span>
                  <span className="figure text-right text-xs text-text-muted">
                    {e.dividend_per_share !== null ? `${fmt(e.dividend_per_share, 2)} / share` : "—"}
                  </span>
                  <span className={cn("text-right text-(length:--text-2xs)", e.eligibility_status === "eligible" ? "text-text-muted" : "text-[var(--clay-1)]")}>
                    {e.eligibility_status === "eligible" ? "Confirmed" : eligibilityLabel(e.eligibility_status)}
                  </span>
                  <span className="figure text-right text-sm font-semibold text-up">
                    {e.net_expected !== null ? `+${fmt(e.net_expected)}` : "—"}
                  </span>
                  <span className="text-right text-(length:--text-2xs) text-text-faint">{open ? "▾" : "▸"}</span>
                </button>

                {open && (
                  <div className="pb-2.5 pl-[74px] pt-3.5">
                    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                      <Meta label="Announced" value={dateOrDash(e.announcement_date)} />
                      <Meta label="Ex-date" value={dateOrDash(e.ex_date)} />
                      <Meta label="Payment" value={e.payment_date ?? (e.estimated_payment_start ? `est. ${e.estimated_payment_start}` : "—")} />
                      <Meta label="DPS" value={fmt(e.dividend_per_share, 2)} />
                      <Meta label="Eligible qty" value={fmt(e.eligible_quantity)} />
                      <Meta label="Gross" value={fmt(e.gross_expected)} />
                      <Meta label="Tax" value={e.estimated_tax !== null ? `−${fmt(e.estimated_tax)}` : "—"} />
                      <Meta label="Source" value={e.source_url ? "PSX announcement" : e.source_type ?? "—"} />
                    </div>

                    {!readOnly && (
                      <div className="mt-4 flex flex-wrap items-center gap-2.5">
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
                        <Button size="sm" variant="ghost" disabled={busyId === e.id}
                          onClick={() => { setQtyDialog(e); setQtyValue(String(e.eligible_quantity ?? "")); }}>
                          Edit quantity
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => act(e.id, { action: "not_eligible" })}>
                          Not eligible
                        </Button>
                        {e.eligibility_status !== "eligible" && (
                          <Button size="sm" variant="ghost" disabled={busyId === e.id} onClick={() => act(e.id, { action: "confirm_eligibility" })}>
                            Confirm eligibility
                          </Button>
                        )}
                        {busyId === e.id && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
                        {(e.notes || !e.tax_rate_configured) && (
                          <span className="text-(length:--text-2xs) text-[var(--clay-1)]">
                            {!e.tax_rate_configured ? "Dividend tax rate is not configured, so net is an estimate." : e.notes}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "estimated" && (
        <div className="ledger">
          {forecasts.length === 0 && (
            <p className="max-w-(--measure) py-6 text-sm text-text-muted">
              No estimates in this period. An estimate appears when a holding has a payment history but no announcement yet.
            </p>
          )}
          {forecasts.map((e) => (
            <div
              key={e.id}
              className="ledger-row grid items-center gap-4"
              style={{ gridTemplateColumns: "minmax(0,1fr) 150px 150px 104px" }}
            >
              <span className="inline-flex min-w-0 items-center gap-2">
                <SectorDot sector={sectorFor(e.ticker)} />
                <span className="text-sm font-semibold text-text-strong">{e.ticker}</span>
                <span className="truncate text-(length:--text-2xs) text-text-muted">{e.company_name ?? e.ticker}</span>
              </span>
              <span className="text-(length:--text-2xs) text-text-faint">
                {dateOrDash(e.estimated_payment_start)} → {dateOrDash(e.estimated_payment_end)}
              </span>
              <span className="figure text-right text-xs text-text-muted">
                {e.dps_low !== null ? `${fmt(e.dps_low, 2)}–${fmt(e.dps_high, 2)} / share` : "from past amounts"}
              </span>
              <span className="figure text-right text-sm font-semibold text-text-strong">
                {e.net_low !== null ? `${fmt(e.net_low)}–${fmt(e.net_high)}` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "received" && (
        <div className="scroll-touch w-full overflow-x-auto">
          <table className="w-full min-w-3xl text-sm">
            <thead>
              <tr className="border-b border-rule-strong">
                {["Paid", "Holding", "Per share", "Shares", "Gross", "Tax", "Net"].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "whitespace-nowrap px-3 pb-2.5 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint",
                      i === 0 ? "pl-0 text-left" : i === 1 ? "text-left" : "text-right",
                      i === 6 && "pr-0"
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {received.map((d) => (
                <tr key={d.id} className="border-b border-rule last:border-0">
                  <td className="figure px-3 py-2.5 pl-0">{d.payment_date ?? d.pay_date ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <SectorDot sector={sectorFor(d.ticker)} />
                      <span className="font-semibold text-text-strong">{d.ticker ?? "—"}</span>
                      <span className="truncate text-(length:--text-2xs) text-text-muted">{d.company_name ?? ""}</span>
                    </span>
                  </td>
                  <td className="figure px-3 py-2.5 text-right">{fmt(d.dividend_per_share, 2)}</td>
                  <td className="figure px-3 py-2.5 text-right">{fmt(d.quantity_held)}</td>
                  <td className="figure px-3 py-2.5 text-right">{fmt(d.amount)}</td>
                  <td className="figure px-3 py-2.5 text-right text-text-muted">{d.tax ? `−${fmt(d.tax)}` : "—"}</td>
                  <td className="figure px-3 py-2.5 pr-0 text-right font-semibold text-up">{fmt(d.net_amount)}</td>
                </tr>
              ))}
              {received.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-sm text-text-muted">No received dividends recorded yet.</td></tr>
              )}
            </tbody>
            {received.length > 0 && (
              <tfoot>
                <tr className="border-t border-rule-strong">
                  <td colSpan={4} className="px-3 py-2.5 pl-0 text-sm font-bold text-text-strong">
                    Total · {received.length} record{received.length === 1 ? "" : "s"}
                  </td>
                  <td className="figure px-3 py-2.5 text-right text-sm font-bold text-text-strong">
                    {fmt(received.reduce((n, d) => n + d.amount, 0))}
                  </td>
                  <td className="figure px-3 py-2.5 text-right text-sm font-bold text-text-muted">
                    −{fmt(received.reduce((n, d) => n + (d.tax ?? 0), 0))}
                  </td>
                  <td className="figure px-3 py-2.5 pr-0 text-right text-sm font-bold text-up">
                    {fmt(received.reduce((n, d) => n + (d.net_amount ?? d.amount - (d.tax ?? 0)), 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {tab === "review" && (
        <div className="ledger">
          {review.length === 0 ? (
            <p className="max-w-(--measure) py-6 text-sm text-text-muted">No dividend records need review in the selected period.</p>
          ) : (
            review.map((e) => {
              const flag = e.status === "overdue" ? "Overdue"
                : e.is_possible_duplicate ? "Duplicate"
                : e.needs_tax_review ? "Tax review"
                : "Unmatched";
              return (
                <div
                  key={e.id}
                  className="ledger-row grid items-center gap-4"
                  style={{ gridTemplateColumns: "minmax(0,104px) 108px minmax(0,1fr) 104px" }}
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-text-strong">
                    <SectorDot sector={sectorFor(e.ticker)} />
                    {e.ticker}
                  </span>
                  <span className={cn(
                    "text-(length:--text-2xs) font-bold uppercase tracking-(--tracking-caps)",
                    e.status === "overdue" ? "text-down" : "text-[var(--clay-1)]"
                  )}>
                    {flag}
                  </span>
                  <span className="min-w-0 truncate text-xs text-text-muted">
                    {e.notes ?? e.eligibility_notes ?? "Review the stored event details."}
                  </span>
                  <span className="figure text-right text-sm font-semibold text-text-strong">{fmt(e.net_expected)}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Edit eligible quantity */}
      <Dialog open={qtyDialog !== null} onClose={() => setQtyDialog(null)} title={`Eligible quantity — ${qtyDialog?.ticker ?? ""}`} className="sm:max-w-xs">
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
      <Dialog open={receiveDialog !== null} onClose={() => setReceiveDialog(null)} title={`Mark received — ${receiveDialog?.ticker ?? ""}`} className="sm:max-w-xs">
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">{label}</span>
      <span className="figure text-xs text-text-strong">{value}</span>
    </span>
  );
}

