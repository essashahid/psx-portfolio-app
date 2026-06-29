import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { accountHasFeature } from "@/lib/features";
import { normalizeRow, validateRow, type CanonicalField } from "@/lib/import/normalize";
import { rejectDemoWrite } from "@/lib/demo-mode";
import type { StatementType } from "@/lib/types";

export const maxDuration = 60;

/**
 * Re-applies a user-edited column mapping (and/or statement type override) to a
 * staged batch, re-normalizing and re-validating every row.
 */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    if (!(await accountHasFeature(supabase, user.id, "/import"))) {
      return NextResponse.json({ error: "Statement imports are disabled for this account." }, { status: 403 });
    }

    const body = (await request.json()) as {
      batchId: string;
      mapping: Record<string, CanonicalField | null>;
      statementType: StatementType;
      saveMappingAs?: string;
    };
    if (!body.batchId || !body.mapping) {
      return NextResponse.json({ error: "batchId and mapping are required" }, { status: 400 });
    }

    const { data: batch } = await supabase
      .from("import_batches")
      .select("id, status")
      .eq("id", body.batchId)
      .eq("user_id", user.id)
      .single();
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    if (batch.status !== "preview") {
      return NextResponse.json({ error: "Batch is no longer in preview" }, { status: 409 });
    }

    const { data: rows } = await supabase
      .from("import_rows")
      .select("id, raw")
      .eq("batch_id", body.batchId)
      .eq("user_id", user.id)
      .order("row_index");

    const seen = new Set<string>();
    const counts = { valid: 0, warning: 0, invalid: 0, duplicate: 0 };
    for (const row of rows ?? []) {
      const normalized = normalizeRow(row.raw as Record<string, unknown>, body.mapping);
      const v = validateRow(normalized, body.statementType);
      let status: string = v.status;
      const issues = [...v.issues];
      if (seen.has(v.rowHash)) {
        status = "duplicate";
        issues.push("Duplicate of another row in this file");
      }
      seen.add(v.rowHash);
      counts[status as keyof typeof counts]++;
      await supabase
        .from("import_rows")
        .update({ normalized: v.normalized, row_hash: v.rowHash, status, issues })
        .eq("id", row.id);
    }

    await supabase
      .from("import_batches")
      .update({ mapping: body.mapping, statement_type: body.statementType })
      .eq("id", body.batchId);

    if (body.saveMappingAs) {
      await supabase.from("import_mappings").insert({
        user_id: user.id,
        name: body.saveMappingAs,
        statement_type: body.statementType,
        mapping: body.mapping,
      });
    }

    return NextResponse.json({ ok: true, counts });
  } catch (err) {
    return errorResponse(err);
  }
}
