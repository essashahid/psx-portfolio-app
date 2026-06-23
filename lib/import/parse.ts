import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseAkdStatement, akdToImportRows, reconcileAkd } from "@/lib/import/akd-statement";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, unknown>[];
  meta: { fileType: "csv" | "xlsx" | "pdf"; pdfText?: string; warnings: string[] };
}

/** Extracts tabular rows from a CSV, XLSX or PDF buffer. */
export async function parseFile(
  buffer: Buffer,
  fileName: string
): Promise<ParsedFile> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "txt") return parseCsv(buffer.toString("utf-8"));
  if (ext === "xlsx" || ext === "xls") return parseXlsx(buffer);
  if (ext === "pdf") return parsePdf(buffer);
  throw new Error(`Unsupported file type ".${ext}". Upload CSV, XLSX or PDF.`);
}

function parseCsv(text: string): ParsedFile {
  const warnings: string[] = [];
  // Some broker exports prepend title lines before the real header row.
  // Find the first line that looks like a header (>= 2 delimited cells, mostly non-numeric).
  const lines = text.split(/\r?\n/);
  let startIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const cells = lines[i].split(",").map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2 && cells.filter((c) => !/^[\d.,()-]+$/.test(c)).length >= 2) {
      startIdx = i;
      break;
    }
  }
  if (startIdx > 0) warnings.push(`Skipped ${startIdx} title line(s) before the header row.`);

  const body = lines.slice(startIdx).join("\n");
  const result = Papa.parse<Record<string, unknown>>(body, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const rows = (result.data ?? []).filter((r) =>
    Object.values(r).some((v) => v !== null && v !== undefined && String(v).trim() !== "")
  );
  return {
    headers: result.meta.fields ?? [],
    rows,
    meta: { fileType: "csv", warnings },
  };
}

function parseXlsx(buffer: Buffer): ParsedFile {
  const warnings: string[] = [];
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook contains no sheets.");
  if (wb.SheetNames.length > 1) {
    warnings.push(`Workbook has ${wb.SheetNames.length} sheets; using "${sheetName}".`);
  }
  const sheet = wb.Sheets[sheetName];
  // Read as a matrix first so we can find the header row (broker files often
  // have logos/titles in the first rows).
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const row = matrix[i] ?? [];
    const nonEmpty = row.filter((c) => c !== null && String(c).trim() !== "");
    const textCells = nonEmpty.filter((c) => typeof c === "string" && !/^[\d.,()-]+$/.test(c.trim()));
    if (nonEmpty.length >= 2 && textCells.length >= 2) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx > 0) warnings.push(`Skipped ${headerIdx} title row(s) before the header row.`);

  const headers = (matrix[headerIdx] ?? []).map((h, i) =>
    h === null || String(h).trim() === "" ? `column_${i + 1}` : String(h).trim()
  );
  const rows: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    if (!row.some((c) => c !== null && String(c).trim() !== "")) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, j) => (obj[h] = row[j] ?? null));
    rows.push(obj);
  }
  return { headers, rows, meta: { fileType: "xlsx", warnings } };
}

async function parsePdf(buffer: Buffer): Promise<ParsedFile> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  const text = result.text ?? "";

  // AKD Securities "Statement Of Account" exports are column-blocked ledgers
  // the generic extractor cannot read; use the dedicated parser when detected.
  const akd = parseAkdStatement(text);
  if (akd) {
    const { headers, rows } = akdToImportRows(akd);
    const warnings = [...akd.warnings];
    const rec = reconcileAkd(akd);
    warnings.push(
      `AKD Statement Of Account detected: ${akd.trades.length} trade(s), ${akd.deposits.length} deposit(s), ${akd.charges.length} fee/CGT entr(ies). Only trades are imported here; deposits, fees and CGT are summarized below.`
    );
    warnings.push(
      rec.cash.matches
        ? `Cash ledger reconciles to the statement balance (PKR ${rec.cash.statedBalance?.toLocaleString()}). Deposits ${rec.cash.deposits.toLocaleString()}, buys ${rec.cash.buys.toLocaleString()}, sells ${rec.cash.sells.toLocaleString()}, CGT ${rec.cash.cgt.toLocaleString()}, fees ${rec.cash.fees.toLocaleString()}.`
        : `Cash ledger did not fully reconcile (computed ${rec.cash.computedBalance.toLocaleString()} vs stated ${rec.cash.statedBalance?.toLocaleString()}, diff ${rec.cash.difference}). Review trades before committing.`
    );
    const gaps = rec.holdings.filter((h) => h.difference);
    if (gaps.length) {
      warnings.push(
        `Holdings not matching the Inventory Position (likely bonus/merger corporate actions to record manually): ${gaps
          .map((g) => `${g.ticker} ${g.difference! > 0 ? "+" : ""}${g.difference}`)
          .join(", ")}.`
      );
    }
    return { headers, rows, meta: { fileType: "pdf", pdfText: text.slice(0, 20000), warnings } };
  }

  const table = extractTableFromText(text);
  return {
    headers: table.headers,
    rows: table.rows,
    meta: { fileType: "pdf", pdfText: text.slice(0, 20000), warnings: table.warnings },
  };
}

/**
 * Best-effort table extraction from PDF text. Broker PDFs render tables as
 * whitespace-aligned lines; we split on runs of 2+ spaces. Rows that don't fit
 * the detected column count are surfaced for manual review rather than dropped
 * silently.
 */
function extractTableFromText(text: string): {
  headers: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, "  ").trimEnd())
    .filter((l) => l.trim().length > 0);

  const HEADER_WORDS =
    /(symbol|scrip|ticker|security|company|qty|quantity|volume|rate|price|cost|value|amount|date|type|buy|sell|dividend|balance|debit|credit)/i;

  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 3 && cells.filter((c) => HEADER_WORDS.test(c)).length >= 2) {
      headerIdx = i;
      headers = cells;
      break;
    }
  }

  if (headerIdx === -1) {
    warnings.push(
      "Could not detect a table header in this PDF. Raw text was extracted — use manual column mapping, or export the statement as CSV/XLSX for best results."
    );
    // Fall back: every line becomes a single-column row so nothing is lost.
    return {
      headers: ["line"],
      rows: lines.slice(0, 400).map((l) => ({ line: l })),
      warnings,
    };
  }

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^(page \d|total|grand total|closing|opening|statement|generated)/i.test(line.trim())) continue;
    const cells = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (Math.abs(cells.length - headers.length) > 2) {
      skipped++;
      continue;
    }
    const obj: Record<string, unknown> = {};
    headers.forEach((h, j) => (obj[h] = cells[j] ?? null));
    rows.push(obj);
  }
  if (skipped > 0) {
    warnings.push(
      `${skipped} PDF line(s) did not match the table layout and were skipped. Verify totals after import.`
    );
  }
  warnings.push(
    "PDF parsing is best-effort. Always review the preview carefully before committing."
  );
  return { headers, rows, warnings };
}
