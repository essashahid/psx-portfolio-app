/**
 * Replays stored email-ingested PDFs through POST /api/ingest/email.
 *
 * Every confirmation the ingest endpoint could not parse is kept in the
 * statements bucket with uploaded_statements.status = 'email_review'. After a
 * parser or infrastructure fix, this script downloads each one and re-submits
 * it, so nothing has to be re-forwarded from Gmail (those threads are already
 * labelled akd-ingested).
 *
 *   INGEST_URL=https://<domain>/api/ingest/email \
 *     npx tsx scripts/maintenance/reprocess-email-statements.ts
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * EMAIL_INGEST_SECRET and EMAIL_INGEST_USER_ID from the environment
 * (.env.local). INGEST_URL defaults to http://localhost:3000/api/ingest/email.
 * The endpoint is idempotent, so re-running is always safe.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const INGEST_URL = process.env.INGEST_URL ?? "http://localhost:3000/api/ingest/email";

async function main() {
  const userId = process.env.EMAIL_INGEST_USER_ID;
  const secret = process.env.EMAIL_INGEST_SECRET;
  if (!userId || !secret) throw new Error("EMAIL_INGEST_USER_ID / EMAIL_INGEST_SECRET missing");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: rows, error } = await supabase
    .from("uploaded_statements")
    .select("id, file_name, file_hash, storage_path, created_at")
    .eq("user_id", userId)
    .eq("status", "email_review")
    .not("storage_path", "is", null)
    .order("created_at");
  if (error) throw error;
  if (!rows?.length) {
    console.log("Nothing to reprocess: no email_review statements found.");
    return;
  }
  console.log(`Reprocessing ${rows.length} stored PDF(s) via ${INGEST_URL}`);

  // One request per distinct file; duplicates of the same hash resolve together.
  const seenHashes = new Set<string>();
  for (const row of rows) {
    if (seenHashes.has(row.file_hash)) continue;
    seenHashes.add(row.file_hash);

    const { data: blob, error: dlErr } = await supabase.storage
      .from("statements")
      .download(row.storage_path!);
    if (dlErr || !blob) {
      console.log(`  ${row.file_name} (${row.created_at}): download failed: ${dlErr?.message}`);
      continue;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ingest-secret": secret },
      body: JSON.stringify({
        from: "AKD Securities Limited <confirmation@akdsl.com>",
        subject: `Reprocess ${row.file_name}`,
        attachments: [
          {
            filename: row.file_name,
            mimeType: "application/pdf",
            dataBase64: buffer.toString("base64"),
          },
        ],
      }),
    });
    const body = await res.json().catch(() => null);
    console.log(`  ${row.file_name} (${row.created_at}): HTTP ${res.status}`);
    console.log(`    ${JSON.stringify(body?.results ?? body)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
