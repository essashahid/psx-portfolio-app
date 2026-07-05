import { PDFDocument } from "pdf-lib";

/**
 * PDF page-splitting for vision extraction. Large PSX filings (annual reports
 * run 28MB+ / 400+ pages) exceed both provider request limits and any sane
 * token budget when sent whole. Splitting into consecutive page-range chunks
 * lets the extractor stream through a filing and stop as soon as it has found
 * the statements, so a 400-page report usually costs a handful of chunks, not
 * the whole document.
 *
 * pdf-lib is pure JS (no native deps), so this runs unchanged on Vercel
 * serverless and locally.
 */

export interface PdfChunk {
  buf: Buffer;
  /** 1-indexed inclusive page range this chunk covers, for prompts/logs. */
  firstPage: number;
  lastPage: number;
}

export async function pdfPageCount(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Split a PDF into consecutive chunks of at most `pagesPerChunk` pages.
 * Returns the original buffer as a single chunk when it already fits.
 */
export async function splitPdfPages(buf: Buffer, pagesPerChunk: number): Promise<PdfChunk[]> {
  const src = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= pagesPerChunk) return [{ buf, firstPage: 1, lastPage: total }];

  const chunks: PdfChunk[] = [];
  for (let start = 0; start < total; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, total);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i));
    for (const p of pages) out.addPage(p);
    const bytes = await out.save();
    chunks.push({ buf: Buffer.from(bytes), firstPage: start + 1, lastPage: end });
  }
  return chunks;
}
