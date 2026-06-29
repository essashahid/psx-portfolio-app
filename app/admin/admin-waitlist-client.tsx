"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { AdminWaitlistRow } from "@/app/api/admin/waitlist/route";

const STATUSES: AdminWaitlistRow["status"][] = ["new", "contacted", "invited", "rejected", "converted"];

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function statusVariant(status: AdminWaitlistRow["status"]) {
  if (status === "new") return "amber";
  if (status === "contacted") return "blue";
  if (status === "invited" || status === "converted") return "green";
  return "red";
}

export function AdminWaitlistClient() {
  const [entries, setEntries] = useState<AdminWaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, { status: AdminWaitlistRow["status"]; admin_notes: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/waitlist?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load waitlist");
      const rows = (data.entries ?? []) as AdminWaitlistRow[];
      setEntries(rows);
      setDrafts((prev) => {
        const next = { ...prev };
        rows.forEach((entry) => {
          next[entry.id] ??= { status: entry.status, admin_notes: entry.admin_notes ?? "" };
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load waitlist");
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  function updateDraft(id: string, patch: Partial<{ status: AdminWaitlistRow["status"]; admin_notes: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function save(entry: AdminWaitlistRow) {
    const draft = drafts[entry.id];
    if (!draft) return;
    setSavingId(entry.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/waitlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, status: draft.status, admin_notes: draft.admin_notes || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save waitlist entry");
      setEntries((prev) => prev.map((row) => (row.id === entry.id ? data.entry : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save waitlist entry");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Waitlist</h2>
          <p className="mt-1 text-sm text-muted-foreground">People who asked for access. Review, contact, then create accounts manually when ready.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search waitlist" className="w-56 pl-9" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
            <option value="all">All statuses</option>
            {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>
      </div>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <THead>
            <TR>
              <TH>Person</TH>
              <TH>Interest</TH>
              <TH>Status</TH>
              <TH>Admin notes</TH>
              <TH>Joined</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {loading ? (
              <TR><TD colSpan={6} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TD></TR>
            ) : entries.length === 0 ? (
              <TR><TD colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No waitlist entries yet.</TD></TR>
            ) : (
              entries.map((entry) => {
                const draft = drafts[entry.id] ?? { status: entry.status, admin_notes: entry.admin_notes ?? "" };
                return (
                  <TR key={entry.id}>
                    <TD className="align-top">
                      <p className="font-medium">{entry.full_name}</p>
                      <p className="text-xs text-muted-foreground">{entry.email ?? "No email"}</p>
                      {entry.phone && <p className="text-xs text-muted-foreground">{entry.phone}</p>}
                    </TD>
                    <TD className="max-w-xs align-top text-sm text-muted-foreground">
                      {entry.note || "-"}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Source: {entry.source}</p>
                    </TD>
                    <TD className="align-top">
                      <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                      <Select
                        value={draft.status}
                        onChange={(e) => updateDraft(entry.id, { status: e.target.value as AdminWaitlistRow["status"] })}
                        className="mt-2 w-32"
                      >
                        {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
                      </Select>
                    </TD>
                    <TD className="align-top">
                      <Input
                        value={draft.admin_notes}
                        onChange={(e) => updateDraft(entry.id, { admin_notes: e.target.value })}
                        placeholder="Private note"
                        className="w-64"
                      />
                    </TD>
                    <TD className="align-top text-sm text-muted-foreground">{fmtDate(entry.created_at)}</TD>
                    <TD className="align-top">
                      <Button size="sm" variant="outline" onClick={() => void save(entry)} disabled={savingId === entry.id}>
                        {savingId === entry.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save
                      </Button>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
