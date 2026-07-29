/**
 * Probes the deployed /api/ingest/email endpoint's PDF extraction without
 * touching real data. Generates a synthetic PDF that passes the
 * trade-confirmation gate but contains one deliberately unreconcilable row,
 * so the endpoint must run pdfjs extraction and the parser, then park the
 * file as needs_review. Parser-level warnings in the response prove
 * extraction works in the serverless runtime; "layout extraction:" /
 * "stream extraction:" warnings mean it does not. Cleans up the probe's
 * uploaded_statements row and storage object afterwards.
 *
 *   INGEST_URL=https://<domain>/api/ingest/email \
 *     npx tsx scripts/maintenance/probe-email-ingest.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

config({ path: ".env.local" });

const INGEST_URL = process.env.INGEST_URL ?? "http://localhost:3000/api/ingest/email";

function makeProbePdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.text("TRADE CONFIRMATION");
    doc.text("Synthetic extraction probe - not a real trade");
    doc.text("P U R C H A S E");
    // qty * rate is nowhere near the amount, so no trade can ever commit.
    doc.text("PROBE 5 9.9900 999999.99");
    doc.end();
  });
}

async function main() {
  const secret = process.env.EMAIL_INGEST_SECRET;
  const userId = process.env.EMAIL_INGEST_USER_ID;
  if (!secret || !userId) throw new Error("EMAIL_INGEST_SECRET / EMAIL_INGEST_USER_ID missing");

  const pdf = await makeProbePdf();
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ingest-secret": secret },
    body: JSON.stringify({
      from: "AKD Securities Limited <confirmation@akdsl.com>",
      subject: "Extraction probe",
      attachments: [
        { filename: "extraction-probe.pdf", mimeType: "application/pdf", dataBase64: pdf.toString("base64") },
      ],
    }),
  });
  const body = await res.json().catch(() => null);
  console.log(`HTTP ${res.status}: ${JSON.stringify(body)}`);

  const result = body?.results?.[0];
  const warnings: string[] = result?.warnings ?? [];
  const extractionBroken = warnings.some((w) => /extraction:/.test(w));
  if (result?.status === "needs_review" && !extractionBroken && warnings.length) {
    console.log("PASS: extraction ran in the deployed runtime (parser-level warnings only).");
  } else if (extractionBroken) {
    console.log("FAIL: extraction is still broken in the deployed runtime.");
  } else {
    console.log("UNEXPECTED: inspect the response above.");
  }

  // Clean up the probe's records.
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rows } = await s
    .from("uploaded_statements")
    .select("id, storage_path")
    .eq("user_id", userId)
    .eq("file_name", "extraction-probe.pdf");
  for (const row of rows ?? []) {
    if (row.storage_path) await s.storage.from("statements").remove([row.storage_path]);
    await s.from("uploaded_statements").delete().eq("id", row.id);
  }
  console.log(`Cleaned up ${rows?.length ?? 0} probe record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
