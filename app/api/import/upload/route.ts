import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { accountHasFeature } from "@/lib/features";
import { parseFile } from "@/lib/import/parse";
import {
  suggestMapping,
  detectStatementType,
  normalizeRow,
  validateRow,
  hashFile,
} from "@/lib/import/normalize";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 60;

const MAX_ROWS = 2000;
const MAX_FILE_MB = 10;

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    if (!(await accountHasFeature(supabase, user.id, "/import"))) {
      return NextResponse.json({ error: "Statement imports are disabled for this account." }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return NextResponse.json({ error: `File exceeds ${MAX_FILE_MB}MB limit` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = hashFile(buffer);
    const ext = file.name.toLowerCase().split(".").pop() ?? "";

    // duplicate-file protection
    const { data: dupe } = await supabase
      .from("uploaded_statements")
      .select("id, file_name, created_at, status")
      .eq("user_id", user.id)
      .eq("file_hash", fileHash)
      .eq("status", "committed")
      .maybeSingle();

    // parse
    const parsed = await parseFile(buffer, file.name);
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: "No data rows could be extracted from this file." },
        { status: 422 }
      );
    }
    if (parsed.rows.length > MAX_ROWS) {
      parsed.meta.warnings.push(`File has ${parsed.rows.length} rows; only the first ${MAX_ROWS} were staged.`);
      parsed.rows = parsed.rows.slice(0, MAX_ROWS);
    }

    const mapping = suggestMapping(parsed.headers);
    const statementType = detectStatementType(mapping);

    // store original file securely (path scoped to the user's folder)
    const storagePath = `${user.id}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error: storageErr } = await supabase.storage
      .from("statements")
      .upload(storagePath, buffer, { contentType: file.type || "application/octet-stream" });
    if (storageErr) parsed.meta.warnings.push(`File storage failed (${storageErr.message}); import can still proceed.`);

    const { data: statement, error: stmtErr } = await supabase
      .from("uploaded_statements")
      .insert({
        user_id: user.id,
        file_name: file.name,
        file_type: ext === "xls" ? "xlsx" : (ext as string),
        file_hash: fileHash,
        storage_path: storageErr ? null : storagePath,
        statement_type: statementType,
        status: "uploaded",
      })
      .select("id")
      .single();
    if (stmtErr) throw stmtErr;

    const { data: batch, error: batchErr } = await supabase
      .from("import_batches")
      .insert({
        user_id: user.id,
        statement_id: statement.id,
        statement_type: statementType,
        status: "preview",
        total_rows: parsed.rows.length,
        mapping,
      })
      .select("id")
      .single();
    if (batchErr) throw batchErr;

    // normalize + validate + stage rows
    const seenHashes = new Set<string>();
    const staged = parsed.rows.map((raw, i) => {
      const normalized = normalizeRow(raw, mapping);
      const v = validateRow(normalized, statementType);
      let status: string = v.status;
      const issues = [...v.issues];
      if (seenHashes.has(v.rowHash)) {
        status = "duplicate";
        issues.push("Duplicate of another row in this file");
      }
      seenHashes.add(v.rowHash);
      return {
        user_id: user.id,
        batch_id: batch.id,
        row_index: i,
        raw,
        normalized: v.normalized,
        row_hash: v.rowHash,
        status,
        issues,
      };
    });

    // check against previously committed rows
    const allHashes = staged.map((r) => r.row_hash);
    const { data: priorTxn } = await supabase
      .from("transactions")
      .select("row_hash")
      .eq("user_id", user.id)
      .in("row_hash", allHashes.slice(0, 1000));
    const prior = new Set((priorTxn ?? []).map((r) => r.row_hash));
    for (const r of staged) {
      if (prior.has(r.row_hash) && r.status !== "invalid") {
        r.status = "duplicate";
        r.issues = [...r.issues, "Already imported in a previous batch"];
      }
    }

    // insert in chunks
    for (let i = 0; i < staged.length; i += 200) {
      const { error: rowErr } = await supabase.from("import_rows").insert(staged.slice(i, i + 200));
      if (rowErr) throw rowErr;
    }

    const counts = {
      valid: staged.filter((r) => r.status === "valid").length,
      warning: staged.filter((r) => r.status === "warning").length,
      invalid: staged.filter((r) => r.status === "invalid").length,
      duplicate: staged.filter((r) => r.status === "duplicate").length,
    };

    return NextResponse.json({
      batchId: batch.id,
      statementId: statement.id,
      statementType,
      headers: parsed.headers,
      mapping,
      counts,
      totalRows: parsed.rows.length,
      warnings: parsed.meta.warnings,
      duplicateFile: dupe
        ? `This exact file was already imported on ${dupe.created_at.slice(0, 10)} (${dupe.file_name}). Committed rows will be skipped automatically.`
        : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
