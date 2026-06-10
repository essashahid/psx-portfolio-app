"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import type { Profile } from "@/lib/types";
import { Loader2, Trash2, Plus } from "lucide-react";

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: profile.full_name ?? "",
    base_currency: profile.base_currency,
    cost_basis_method: profile.cost_basis_method,
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update(form)
      .eq("id", profile.id);
    setBusy(false);
    setMsg(error ? `Error: ${error.message}` : "Profile saved.");
    if (!error) router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Full name</Label>
          <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Base currency</Label>
          <Select value={form.base_currency} onChange={(e) => setForm({ ...form, base_currency: e.target.value })}>
            <option value="PKR">PKR (Pakistani Rupee)</option>
            <option value="USD">USD</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Cost basis method</Label>
          <Select value={form.cost_basis_method} onChange={(e) => setForm({ ...form, cost_basis_method: e.target.value })}>
            <option value="weighted_average">Weighted average (default)</option>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save profile
        </Button>
        {msg && <p className={`text-xs ${msg.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>{msg}</p>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Manual prices
// ---------------------------------------------------------------------------
export function PriceManager({
  holdings,
}: {
  holdings: { ticker: string; latest_price: number | null; price_date: string | null; price_source: string | null }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg(data.message ?? "Done.");
      setValues({});
      setCsv("");
      router.refresh();
    } catch (err) {
      setMsg(`Error: ${err instanceof Error ? err.message : "failed"}`);
    } finally {
      setBusy(false);
    }
  }

  function saveAll() {
    const prices = Object.entries(values)
      .map(([ticker, v]) => ({ ticker, price: parseFloat(v) }))
      .filter((p) => Number.isFinite(p.price) && p.price > 0);
    if (prices.length === 0) {
      setMsg("Error: enter at least one price first.");
      return;
    }
    post({ prices });
  }

  return (
    <div className="space-y-4">
      <Table>
        <THead>
          <TR>
            <TH>Ticker</TH>
            <TH className="text-right">Current price</TH>
            <TH>As of</TH>
            <TH>Source</TH>
            <TH>New price</TH>
          </TR>
        </THead>
        <TBody>
          {holdings.map((h) => (
            <TR key={h.ticker}>
              <TD className="font-semibold">{h.ticker}</TD>
              <TD className="text-right tabular-nums text-xs">
                {h.latest_price !== null ? formatNumber(h.latest_price) : <span className="text-amber-600">no price</span>}
              </TD>
              <TD className="text-xs text-muted-foreground">{h.price_date ?? "—"}</TD>
              <TD className="text-xs text-muted-foreground">{h.price_source ?? "—"}</TD>
              <TD>
                <Input
                  className="h-8 w-28 text-xs"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="PKR"
                  value={values[h.ticker] ?? ""}
                  onChange={(e) => setValues({ ...values, [h.ticker]: e.target.value })}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={saveAll} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save entered prices
        </Button>
        {msg && <p className={`text-xs ${msg.startsWith("Error") ? "text-red-600" : "text-emerald-700"}`}>{msg}</p>}
      </div>
      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <Label>Bulk upload prices (CSV)</Label>
        <p className="text-[11px] text-muted-foreground">
          Format: <code>ticker,price[,date]</code> — one row per line, header optional.
        </p>
        <Textarea
          rows={4}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"ticker,price,date\nMEBL,248.50,2026-06-10\nFFC,158.40"}
          className="font-mono text-xs"
        />
        <Button size="sm" variant="outline" disabled={busy || !csv.trim()} onClick={() => post({ csv: `ticker,price,date\n${csv.replace(/^ticker.*\n/i, "")}` })}>
          Upload CSV prices
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broker account labels
// ---------------------------------------------------------------------------
export function BrokerAccounts({
  accounts,
}: {
  accounts: { id: string; label: string; broker_type: string }[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [type, setType] = useState("AKD");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("broker_accounts").insert({ user_id: user.id, label: label.trim(), broker_type: type });
    }
    setBusy(false);
    setLabel("");
    router.refresh();
  }

  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("broker_accounts").delete().eq("id", id);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {accounts.length > 0 && (
        <ul className="space-y-1.5">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs">
              <span><span className="font-medium">{a.label}</span> <span className="text-muted-foreground">({a.broker_type})</span></span>
              <button onClick={() => remove(a.id)} className="text-muted-foreground hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label>Label</Label>
          <Input className="h-8 w-44 text-xs" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. AKD main account" />
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select className="h-8 w-28 text-xs" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="AKD">AKD</option>
            <option value="CDC">CDC</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        Labels only — PortfolioOS never asks for or stores brokerage credentials.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved import mappings
// ---------------------------------------------------------------------------
export function SavedMappings({
  mappings,
}: {
  mappings: { id: string; name: string; statement_type: string; created_at: string }[];
}) {
  const router = useRouter();
  async function remove(id: string) {
    const supabase = createClient();
    await supabase.from("import_mappings").delete().eq("id", id);
    router.refresh();
  }
  if (mappings.length === 0) {
    return <p className="text-xs text-muted-foreground">No saved mappings yet. They are created from the Import Center when you save a custom column mapping.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {mappings.map((m) => (
        <li key={m.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs">
          <span><span className="font-medium">{m.name}</span> <span className="text-muted-foreground">({m.statement_type}, saved {m.created_at.slice(0, 10)})</span></span>
          <button onClick={() => remove(m.id)} className="text-muted-foreground hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Uploaded statements
// ---------------------------------------------------------------------------
export function StatementsList({
  statements,
}: {
  statements: { id: string; file_name: string; file_type: string; statement_type: string | null; status: string; created_at: string }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(id: string) {
    if (!window.confirm("Delete this uploaded file? Committed portfolio data will be kept.")) return;
    setBusyId(id);
    await fetch(`/api/statements/${id}`, { method: "DELETE" });
    setBusyId(null);
    router.refresh();
  }

  if (statements.length === 0) {
    return <p className="text-xs text-muted-foreground">No uploaded statements.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {statements.map((s) => (
        <li key={s.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-xs">
          <span className="min-w-0 truncate">
            <span className="font-medium">{s.file_name}</span>{" "}
            <span className="text-muted-foreground">
              ({s.file_type}, {s.statement_type ?? "?"}, {s.status}, {s.created_at.slice(0, 10)})
            </span>
          </span>
          <button onClick={() => remove(s.id)} disabled={busyId === s.id} className="ml-2 shrink-0 text-muted-foreground hover:text-red-600">
            {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
