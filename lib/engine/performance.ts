import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAkdStatement } from "@/lib/import/akd-statement";
import { analyzeLedger, type LedgerAnalytics } from "@/lib/engine/ledger-analytics";

/**
 * Downloads the most recent committed AKD statement PDF from Supabase Storage,
 * re-parses it and runs the full analytics engine. Returns null if no suitable
 * statement is found or if parsing fails.
 */
export async function getPerformanceAnalytics(
  supabase: SupabaseClient,
  userId: string
): Promise<LedgerAnalytics | null> {
  const { data: stmts } = await supabase
    .from("uploaded_statements")
    .select("storage_path")
    .eq("user_id", userId)
    .eq("status", "committed")
    .eq("file_type", "pdf")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!stmts?.length) return null;

  for (const row of stmts) {
    if (!row.storage_path) continue;
    try {
      const { data: blob, error } = await supabase.storage
        .from("statements")
        .download(row.storage_path as string);
      if (error || !blob) continue;

      const buffer = Buffer.from(await blob.arrayBuffer());
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      await parser.destroy();

      const stmt = parseAkdStatement(result.text ?? "");
      if (stmt) return analyzeLedger(stmt);
    } catch {
      continue;
    }
  }

  return null;
}
