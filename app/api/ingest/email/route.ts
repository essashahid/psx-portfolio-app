import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAkdConfirmation, parseDayMonthNameYear } from "@/lib/import/akd-confirmation";
import { extractPdfLayoutText } from "@/lib/import/pdf-layout";
import { recomputeHoldingsFromTransactions } from "@/lib/portfolio/positions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTACHMENT_MB = 10;

/**
 * POST /api/ingest/email
 *
 * Receives AKD trade-confirmation emails forwarded by the Gmail Apps Script
 * bridge (scripts/apps-script/akd-gmail-ingest.gs). Server-to-server: no user
 * session. Protected by EMAIL_INGEST_SECRET; all writes go to the single
 * account named by EMAIL_INGEST_USER_ID.
 *
 * Per PDF attachment: store the file in the statements bucket, record it in
 * uploaded_statements (status email_committed, or email_review when parsing
 * fails so nothing is silently dropped), parse the confirmation table, and
 * insert the fills as transactions with source "email_confirmation".
 *
 * Idempotent at two levels: a re-forwarded file is skipped by file_hash, and
 * each fill carries a deterministic row_hash (account, date, side, ticker,
 * qty, rate, per-file sequence) so re-processing never double-counts.
 */
export async function POST(request: Request) {
  const secret = process.env.EMAIL_INGEST_SECRET;
  const userId = process.env.EMAIL_INGEST_USER_ID;
  if (!secret || !userId) {
    return NextResponse.json(
      { error: "EMAIL_INGEST_SECRET / EMAIL_INGEST_USER_ID are not configured." },
      { status: 503 }
    );
  }
  const provided =
    request.headers.get("x-ingest-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    from?: string;
    subject?: string;
    messageId?: string;
    attachments?: { filename?: string; mimeType?: string; dataBase64?: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // The Apps Script already filters by sender, but the endpoint re-checks so a
  // leaked URL alone cannot inject trades from arbitrary mail.
  if (!/akdsl\.com/i.test(body.from ?? "")) {
    return NextResponse.json({ error: "Sender not allowed" }, { status: 403 });
  }

  const subjectDate = parseDayMonthNameYear(
    body.subject?.match(/dated\s+([\d]{1,2}-[A-Za-z]{3,9}-\d{4})/i)?.[1] ?? null
  );

  const admin = createAdminClient();
  const results: {
    filename: string;
    status: "committed" | "duplicate_file" | "needs_review" | "error";
    trades?: number;
    duplicates?: number;
    warnings?: string[];
    error?: string;
  }[] = [];

  const pdfs = (body.attachments ?? []).filter(
    (att) =>
      att.dataBase64 &&
      (att.mimeType === "application/pdf" || /\.pdf$/i.test(att.filename ?? ""))
  );
  if (!pdfs.length) {
    return NextResponse.json({ error: "No PDF attachment in payload" }, { status: 422 });
  }

  for (const att of pdfs) {
    const filename = (att.filename || "confirmation.pdf").replace(/[^\w.\-]+/g, "_");
    try {
      const buffer = Buffer.from(att.dataBase64!, "base64");
      if (buffer.length > MAX_ATTACHMENT_MB * 1024 * 1024) {
        results.push({ filename, status: "error", error: "Attachment exceeds size limit" });
        continue;
      }
      const fileHash = createHash("sha256").update(buffer).digest("hex");

      const { data: dupe } = await admin
        .from("uploaded_statements")
        .select("id")
        .eq("user_id", userId)
        .eq("file_hash", fileHash)
        .in("status", ["committed", "email_committed"])
        .maybeSingle();
      if (dupe) {
        results.push({ filename, status: "duplicate_file" });
        continue;
      }

      // Layout-aware extraction rebuilds the table's visual rows; the plain
      // pdf-parse stream (scrambled column blocks) is the second attempt.
      let confirmation: ReturnType<typeof parseAkdConfirmation> = null;
      try {
        const layoutText = await extractPdfLayoutText(buffer);
        confirmation = parseAkdConfirmation(layoutText, subjectDate);
      } catch {
        confirmation = null;
      }
      if (!confirmation?.trades.length) {
        try {
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: new Uint8Array(buffer) });
          const parsed = await parser.getText();
          await parser.destroy();
          const streamParsed = parseAkdConfirmation(parsed.text ?? "", subjectDate);
          if (streamParsed?.trades.length || !confirmation) confirmation = streamParsed;
        } catch {
          // keep whatever the layout pass produced (possibly null)
        }
      }

      const storagePath = `${userId}/email/${fileHash.slice(0, 12)}_${filename}`;
      const { error: storageErr } = await admin.storage
        .from("statements")
        .upload(storagePath, buffer, { contentType: "application/pdf", upsert: true });

      const parsedOk = !!confirmation && confirmation.trades.length > 0;
      const { error: stmtErr } = await admin.from("uploaded_statements").insert({
        user_id: userId,
        file_name: filename,
        file_type: "pdf",
        file_hash: fileHash,
        storage_path: storageErr ? null : storagePath,
        statement_type: "trades",
        status: parsedOk ? "email_committed" : "email_review",
      });
      if (stmtErr) throw stmtErr;

      if (!parsedOk) {
        results.push({
          filename,
          status: "needs_review",
          warnings: confirmation?.warnings ?? ["PDF text did not match the trade-confirmation layout"],
        });
        continue;
      }

      const account = confirmation!.account ?? "COAF";
      const tradeDate = confirmation!.tradeDate ?? subjectDate ?? null;
      const uid8 = userId.slice(0, 8);
      const rows = confirmation!.trades.map((t, i) => ({
        row_hash: createHash("sha256")
          .update(
            `akdconf-${uid8}-${account}-${tradeDate ?? "nodate"}-${t.side}-${t.ticker}-${t.quantity}-${t.rate}-${i}`
          )
          .digest("hex"),
        trade: t,
      }));

      const { data: existing } = await admin
        .from("transactions")
        .select("row_hash")
        .eq("user_id", userId)
        .in("row_hash", rows.map((r) => r.row_hash));
      const seen = new Set((existing ?? []).map((e) => e.row_hash as string));

      let committed = 0;
      let duplicates = 0;
      for (const { row_hash, trade } of rows) {
        if (seen.has(row_hash)) {
          duplicates++;
          continue;
        }
        const charges = (trade.commission ?? 0) + (trade.tax ?? 0) + (trade.cdc ?? 0);
        const net =
          trade.net ??
          (charges > 0
            ? trade.side === "BUY"
              ? trade.gross + charges
              : trade.gross - charges
            : null);
        const { error: insErr } = await admin.from("transactions").insert({
          user_id: userId,
          ticker: trade.ticker,
          trade_date: tradeDate,
          type: trade.side,
          quantity: trade.quantity,
          price: trade.rate,
          gross_amount: trade.gross,
          commission: trade.commission,
          tax: trade.tax,
          net_amount: net,
          row_hash,
          source: "email_confirmation",
        });
        if (insErr) throw insErr;
        committed++;
        seen.add(row_hash);
      }

      if (committed > 0) {
        await recomputeHoldingsFromTransactions(admin, userId);
      }
      results.push({
        filename,
        status: "committed",
        trades: committed,
        duplicates,
        warnings: confirmation!.warnings.length ? confirmation!.warnings : undefined,
      });
    } catch (err) {
      results.push({
        filename,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ok = results.every((r) => r.status !== "error");
  return NextResponse.json({ results }, { status: ok ? 200 : 207 });
}
