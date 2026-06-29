import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { accountHasFeature } from "@/lib/features";
import { commitBatch } from "@/lib/import/commit";
import { refreshAlerts } from "@/lib/alerts";
import { takeSnapshot } from "@/lib/portfolio";
import { enrichHoldingsMetadata } from "@/lib/holdings/enrichment";
import type { NormalizedRow, StatementType } from "@/lib/types";

export const maxDuration = 120;

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    if (!(await accountHasFeature(supabase, user.id, "/import"))) {
      return NextResponse.json({ error: "Statement imports are disabled for this account." }, { status: 403 });
    }

    const body = (await request.json()) as { batchId: string; excludedRowIds?: string[] };
    if (!body.batchId) return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    const excluded = new Set(body.excludedRowIds ?? []);

    const { data: batch } = await supabase
      .from("import_batches")
      .select("id, statement_id, statement_type, status")
      .eq("id", body.batchId)
      .eq("user_id", user.id)
      .single();
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    if (batch.status === "committed") {
      return NextResponse.json({ error: "This batch was already committed" }, { status: 409 });
    }

    const { data: rows } = await supabase
      .from("import_rows")
      .select("id, row_hash, normalized, status")
      .eq("batch_id", body.batchId)
      .eq("user_id", user.id)
      .order("row_index");

    const commitRows = (rows ?? []).filter(
      (r) => (r.status === "valid" || r.status === "warning") && !excluded.has(r.id)
    );
    if (commitRows.length === 0) {
      return NextResponse.json(
        { error: "No valid rows to commit. Fix the mapping or include at least one row." },
        { status: 422 }
      );
    }

    const result = await commitBatch(
      supabase,
      user.id,
      batch.id,
      batch.statement_type as StatementType,
      commitRows.map((r) => ({
        id: r.id,
        row_hash: r.row_hash,
        normalized: r.normalized as NormalizedRow,
      }))
    );

    // mark row outcomes
    const committedIds = commitRows.map((r) => r.id);
    for (let i = 0; i < committedIds.length; i += 200) {
      await supabase
        .from("import_rows")
        .update({ status: "committed" })
        .in("id", committedIds.slice(i, i + 200));
    }
    if (excluded.size > 0) {
      await supabase
        .from("import_rows")
        .update({ status: "excluded" })
        .in("id", [...excluded])
        .eq("user_id", user.id);
    }

    const rejected = (rows ?? []).filter((r) => r.status === "invalid").length;
    const duplicates =
      (rows ?? []).filter((r) => r.status === "duplicate").length + result.duplicates;

    await supabase
      .from("import_batches")
      .update({
        status: "committed",
        accepted_rows: result.committed,
        rejected_rows: rejected,
        duplicate_rows: duplicates,
        summary: { ...result, excluded: excluded.size },
        committed_at: new Date().toISOString(),
      })
      .eq("id", batch.id);
    await supabase
      .from("uploaded_statements")
      .update({ status: "committed" })
      .eq("id", batch.statement_id);

    let enrichment: Awaited<ReturnType<typeof enrichHoldingsMetadata>> | null = null;
    let enrichmentError: string | null = null;
    try {
      if (await accountHasFeature(supabase, user.id, "company_enrichment")) {
        enrichment = await enrichHoldingsMetadata(supabase, user.id, { tickers: result.holdingsTouched });
      } else {
        enrichmentError = "Company enrichment is disabled for this account.";
      }
    } catch (err) {
      enrichmentError = err instanceof Error ? err.message : String(err);
    }

    await takeSnapshot(supabase, user.id);
    await refreshAlerts(supabase, user.id);

    return NextResponse.json({
      ok: true,
      ...result,
      metadataEnrichment: enrichment,
      metadataEnrichmentError: enrichmentError,
      rejected,
      duplicates,
      excluded: excluded.size,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
