"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CANONICAL_FIELDS } from "@/lib/import/fields";
import type { NormalizedRow, StatementType } from "@/lib/types";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

type Step = "upload" | "preview" | "done";

interface UploadResponse {
  batchId: string;
  statementType: StatementType;
  headers: string[];
  mapping: Record<string, string | null>;
  counts: { valid: number; warning: number; invalid: number; duplicate: number };
  totalRows: number;
  warnings: string[];
  duplicateFile: string | null;
}

interface StagedRow {
  id: string;
  row_index: number;
  raw: Record<string, unknown>;
  normalized: NormalizedRow;
  status: string;
  issues: string[];
}

const STATEMENT_TYPES: { value: StatementType; label: string }[] = [
  { value: "holdings", label: "Current holdings snapshot" },
  { value: "trades", label: "Trade history" },
  { value: "dividends", label: "Dividend / cash statement" },
  { value: "generic", label: "Generic broker statement" },
];

const STATUS_BADGE: Record<string, "green" | "amber" | "red" | "secondary"> = {
  valid: "green",
  warning: "amber",
  invalid: "red",
  duplicate: "secondary",
};

export function ImportWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [statementType, setStatementType] = useState<StatementType>("generic");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [showMapping, setShowMapping] = useState(false);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const loadRows = useCallback(async (batchId: string) => {
    setRowsLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("import_rows")
      .select("id, row_index, raw, normalized, status, issues")
      .eq("batch_id", batchId)
      .order("row_index")
      .limit(500);
    setRows((data ?? []) as StagedRow[]);
    setRowsLoading(false);
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const u = data as UploadResponse;
      setUpload(u);
      setMapping(u.mapping);
      setStatementType(u.statementType);
      setStep("preview");
      await loadRows(u.batchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyMapping() {
    if (!upload) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import/remap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: upload.batchId, mapping, statementType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Re-mapping failed");
      setUpload({ ...upload, counts: data.counts, statementType });
      await loadRows(upload.batchId);
      setShowMapping(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-mapping failed");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!upload) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: upload.batchId, excludedRowIds: [...excluded] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Commit failed");
      setSummary(data);
      setStep("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    // recompute nothing client-side; counts come from server
  }, [rows]);

  // ---------- STEP: upload ----------
  if (step === "upload") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upload a statement</CardTitle>
          <CardDescription>
            AKD/CDC holdings, trade history, or dividend/cash statements — CSV, Excel (.xlsx) or PDF.
            Files are stored privately; nothing changes your portfolio until you confirm the preview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 py-12 transition-colors hover:bg-muted/60"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            {busy ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Parsing statement…</p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Drop a file here or click to browse</p>
                <p className="text-xs text-muted-foreground">CSV, XLSX or PDF · max 10 MB</p>
              </>
            )}
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.pdf,.txt"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <p>• <strong>Holdings snapshot</strong>: updates positions to match the statement.</p>
            <p>• <strong>Trade history</strong>: stores transactions, recalculates weighted-average cost.</p>
            <p>• <strong>Dividend/cash</strong>: records dividends and cash movements.</p>
            <p>• Duplicate files and rows are detected automatically and never double-counted.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------- STEP: done ----------
  if (step === "done" && summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Import complete
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{String(summary.message ?? "")}</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="green">{Number(summary.committed ?? 0)} committed</Badge>
            <Badge variant="secondary">{Number(summary.duplicates ?? 0)} duplicates skipped</Badge>
            <Badge variant="amber">{Number(summary.excluded ?? 0)} excluded by you</Badge>
            <Badge variant="red">{Number(summary.rejected ?? 0)} rejected</Badge>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={() => { setStep("upload"); setUpload(null); setRows([]); setSummary(null); setExcluded(new Set()); }}>
              Import another file
            </Button>
            <Button variant="outline" onClick={() => router.push("/holdings")}>View holdings</Button>
            <Button variant="outline" onClick={() => router.push("/dashboard")}>Go to dashboard</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---------- STEP: preview ----------
  if (!upload) return null;
  const includable = rows.filter((r) => (r.status === "valid" || r.status === "warning") && !excluded.has(r.id));
  const previewCols: (keyof NormalizedRow)[] =
    statementType === "holdings"
      ? ["ticker", "company_name", "quantity", "avg_cost", "market_price", "market_value"]
      : statementType === "trades"
        ? ["trade_date", "ticker", "type", "quantity", "price", "commission", "tax", "net_amount"]
        : ["trade_date", "ticker", "type", "dividend_amount", "net_amount", "description"];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> Review parsed data
          </CardTitle>
          <CardDescription>
            {upload.totalRows} row(s) staged. Nothing is applied until you confirm below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {upload.duplicateFile && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> {upload.duplicateFile}
            </p>
          )}
          {upload.warnings.map((w, i) => (
            <p key={i} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">{w}</p>
          ))}

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Detected statement type</label>
              <Select
                value={statementType}
                onChange={(e) => setStatementType(e.target.value as StatementType)}
                className="w-64"
              >
                {STATEMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowMapping((s) => !s)}>
              {showMapping ? "Hide column mapping" : "Map columns"}
            </Button>
            {(showMapping || statementType !== upload.statementType) && (
              <Button size="sm" onClick={applyMapping} disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply mapping & re-validate
              </Button>
            )}
            <div className="ml-auto flex gap-1.5">
              <Badge variant="green">{upload.counts.valid} valid</Badge>
              <Badge variant="amber">{upload.counts.warning} warnings</Badge>
              <Badge variant="red">{upload.counts.invalid} invalid</Badge>
              <Badge variant="secondary">{upload.counts.duplicate} duplicates</Badge>
            </div>
          </div>

          {showMapping && (
            <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {upload.headers.map((h) => (
                <div key={h} className="flex items-center gap-2">
                  <span className="w-1/2 truncate text-xs font-medium" title={h}>{h}</span>
                  <Select
                    value={mapping[h] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [h]: e.target.value || null })}
                    className="h-8 text-xs"
                  >
                    <option value="">— ignore —</option>
                    {CANONICAL_FIELDS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staged rows</CardTitle>
          <CardDescription>
            Untick any row you want to exclude. Invalid and duplicate rows are never committed; they stay stored for review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rowsLoading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-8">Use</TH>
                    <TH>#</TH>
                    {previewCols.map((c) => <TH key={c}>{c.replace(/_/g, " ")}</TH>)}
                    <TH>Status</TH>
                    <TH>Issues</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => {
                    const committable = r.status === "valid" || r.status === "warning";
                    return (
                      <TR key={r.id} className={r.status === "invalid" ? "opacity-50" : ""}>
                        <TD>
                          <input
                            type="checkbox"
                            disabled={!committable}
                            checked={committable && !excluded.has(r.id)}
                            onChange={() => toggleRow(r.id)}
                          />
                        </TD>
                        <TD className="text-muted-foreground">{r.row_index + 1}</TD>
                        {previewCols.map((c) => (
                          <TD key={c} className="max-w-[160px] truncate text-xs">
                            {r.normalized?.[c] !== null && r.normalized?.[c] !== undefined
                              ? String(r.normalized[c])
                              : "—"}
                          </TD>
                        ))}
                        <TD><Badge variant={STATUS_BADGE[r.status] ?? "secondary"}>{r.status}</Badge></TD>
                        <TD className="max-w-[240px] truncate text-xs text-muted-foreground" title={r.issues.join("; ")}>
                          {r.issues.join("; ") || "—"}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proposed changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            {statementType === "holdings" && (
              <>This will <strong>update {new Set(includable.map((r) => r.normalized.ticker)).size} holding position(s)</strong> to match the statement snapshot (source: <code>statement_snapshot</code>). No trade history will be invented.</>
            )}
            {statementType === "trades" && (
              <>This will <strong>add {includable.length} transaction(s)</strong> and recalculate all holdings with weighted-average cost. Realized gain/loss is tracked on sells.</>
            )}
            {(statementType === "dividends" || statementType === "generic") && (
              <>This will <strong>record {includable.length} dividend/cash row(s)</strong>, linked to tickers where possible.</>
            )}
          </p>
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={commit} disabled={busy || includable.length === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm import ({includable.length} rows)
            </Button>
            <Button
              variant="outline"
              onClick={() => { setStep("upload"); setUpload(null); setRows([]); setExcluded(new Set()); setError(null); }}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
