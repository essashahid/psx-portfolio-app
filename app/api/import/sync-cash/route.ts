import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { parseAkdStatement } from "@/lib/import/akd-statement";

export const maxDuration = 60;

/**
 * POST /api/import/sync-cash
 *
 * Downloads the most recent committed AKD statement PDF from storage, parses
 * every deposit, CGT charge and account fee, and writes them to cash_movements
 * (type CASH_IN / TAX / FEE) with dated movement_date entries.
 *
 * Idempotent: each row gets a deterministic row_hash so re-running never
 * double-counts. Returns counts of what was added vs. already present.
 */
export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    // Find committed AKD PDFs ordered newest first.
    const { data: stmts } = await supabase
      .from("uploaded_statements")
      .select("storage_path")
      .eq("user_id", user.id)
      .eq("status", "committed")
      .eq("file_type", "pdf")
      .not("storage_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    if (!stmts?.length) {
      return NextResponse.json(
        { error: "No committed AKD statement found. Import a statement first." },
        { status: 404 }
      );
    }

    // Try each PDF until one parses as AKD.
    let stmt = null;
    for (const row of stmts) {
      if (!row.storage_path) continue;
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("statements")
          .download(row.storage_path as string);
        if (dlErr || !blob) continue;
        const buffer = Buffer.from(await blob.arrayBuffer());
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await parser.getText();
        await parser.destroy();
        stmt = parseAkdStatement(result.text ?? "");
        if (stmt) break;
      } catch {
        continue;
      }
    }

    if (!stmt) {
      return NextResponse.json(
        { error: "Could not parse any AKD statement from the stored files." },
        { status: 422 }
      );
    }

    // Deterministic row hash per entry so inserts are idempotent.
    const uid8 = user.id.slice(0, 8);
    function makeHash(kind: string, date: string | null, amount: number): string {
      return `akd-${kind}-${uid8}-${date ?? "nodate"}-${Math.round(amount * 100)}`;
    }

    // Collect all hashes so we can batch-check for duplicates.
    const depositHashes = stmt.deposits.map((d) => makeHash("deposit", d.date, d.amount));
    const chargeHashes = stmt.charges.map((c) =>
      makeHash(c.kind === "CGT" ? "cgt" : "fee", c.date, c.amount)
    );
    const allHashes = [...depositHashes, ...chargeHashes];

    const { data: existing } = allHashes.length
      ? await supabase
          .from("cash_movements")
          .select("row_hash")
          .eq("user_id", user.id)
          .in("row_hash", allHashes)
      : { data: [] };
    const seen = new Set((existing ?? []).map((r) => r.row_hash as string));

    let depositsAdded = 0;
    let chargesAdded = 0;
    let skipped = 0;

    for (let i = 0; i < stmt.deposits.length; i++) {
      const d = stmt.deposits[i];
      const hash = depositHashes[i];
      if (seen.has(hash)) { skipped++; continue; }
      const { error: insErr } = await supabase.from("cash_movements").insert({
        user_id: user.id,
        movement_date: d.date,
        type: "CASH_IN",
        amount: d.amount,
        description: d.narration.slice(0, 200),
        row_hash: hash,
      });
      if (!insErr) { depositsAdded++; seen.add(hash); }
    }

    for (let i = 0; i < stmt.charges.length; i++) {
      const c = stmt.charges[i];
      const hash = chargeHashes[i];
      if (seen.has(hash)) { skipped++; continue; }
      const { error: insErr } = await supabase.from("cash_movements").insert({
        user_id: user.id,
        movement_date: c.date,
        type: c.kind === "CGT" ? "TAX" : "FEE",
        amount: c.amount,
        description: c.narration.slice(0, 200),
        row_hash: hash,
      });
      if (!insErr) { chargesAdded++; seen.add(hash); }
    }

    const total = depositsAdded + chargesAdded;
    return NextResponse.json({
      depositsAdded,
      chargesAdded,
      skipped,
      message: total > 0
        ? `Synced ${depositsAdded} deposit(s) and ${chargesAdded} charge(s) to cash ledger${skipped ? ` (${skipped} already present)` : ""}.`
        : `Cash ledger already up to date (${skipped} entries already present).`,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
