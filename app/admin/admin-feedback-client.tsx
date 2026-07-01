"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { AdminFeedbackRow } from "@/app/api/admin/feedback/route";

const STATUSES: AdminFeedbackRow["status"][] = ["new", "reviewed", "closed"];

function fmtDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusVariant(status: AdminFeedbackRow["status"]) {
  if (status === "new") return "amber";
  if (status === "reviewed") return "blue";
  return "green";
}

function kindVariant(kind: AdminFeedbackRow["kind"]) {
  if (kind === "bug") return "red";
  if (kind === "confusing") return "amber";
  if (kind === "idea" || kind === "missing") return "blue";
  return "secondary";
}

export function AdminFeedbackClient() {
  const [feedback, setFeedback] = useState<AdminFeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, { status: AdminFeedbackRow["status"]; admin_notes: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load feedback");
      const rows = (data.feedback ?? []) as AdminFeedbackRow[];
      setFeedback(rows);
      setDrafts((prev) => {
        const next = { ...prev };
        rows.forEach((entry) => {
          next[entry.id] ??= { status: entry.status, admin_notes: entry.admin_notes ?? "" };
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  function updateDraft(id: string, patch: Partial<{ status: AdminFeedbackRow["status"]; admin_notes: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function save(entry: AdminFeedbackRow) {
    const draft = drafts[entry.id];
    if (!draft) return;
    setSavingId(entry.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, status: draft.status, admin_notes: draft.admin_notes || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save feedback");
      setFeedback((prev) => prev.map((row) => (row.id === entry.id ? data.feedback : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Feedback</h2>
          <p className="mt-1 text-sm text-muted-foreground">Comments from demo and private users, grouped by browser visitor id.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search feedback" className="w-56 pl-9" />
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
              <TH>Feedback</TH>
              <TH>Context</TH>
              <TH>Status</TH>
              <TH>Admin notes</TH>
              <TH>Received</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {loading ? (
              <TR><TD colSpan={6} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TD></TR>
            ) : feedback.length === 0 ? (
              <TR><TD colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No feedback yet.</TD></TR>
            ) : (
              feedback.map((entry) => {
                const draft = drafts[entry.id] ?? { status: entry.status, admin_notes: entry.admin_notes ?? "" };
                const visitorShort = entry.visitor_id.slice(0, 18);
                return (
                  <TR key={entry.id}>
                    <TD className="max-w-md align-top whitespace-normal">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant={kindVariant(entry.kind)}>{entry.kind}</Badge>
                        {entry.rating && <Badge variant="outline">{entry.rating}/5</Badge>}
                      </div>
                      <p className="text-sm leading-relaxed">{entry.message}</p>
                      {entry.contact && <p className="mt-1 text-xs text-muted-foreground">Contact: {entry.contact}</p>}
                    </TD>
                    <TD className="max-w-xs align-top whitespace-normal text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{entry.page_path}</p>
                      <p className="mt-1">Visitor: {visitorShort}</p>
                      <p>User: {entry.user_id?.slice(0, 8) ?? "-"}</p>
                    </TD>
                    <TD className="align-top">
                      <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                      <Select
                        value={draft.status}
                        onChange={(e) => updateDraft(entry.id, { status: e.target.value as AdminFeedbackRow["status"] })}
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
