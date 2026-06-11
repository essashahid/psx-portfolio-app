/**
 * Extracts dividend facts from an official PSX announcement PDF.
 *
 * PSX company-announcement *titles* rarely contain the actual rupees-per-share
 * (they say "Credit of Interim Cash Dividend", "Notice of Interim Dividend"),
 * but the linked PDF body almost always does — e.g. "Cash Dividend @ Rs.8/- per
 * share i.e. 160%" or "final Cash Dividend of Rs. 2/- per share". This module
 * downloads that PDF, reads its text, and pulls out the per-share value, book
 * closure window, payment date, and whether the dividend has already been
 * credited (paid) versus newly declared (upcoming).
 */

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PDF_BYTES = 6_000_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "*/*",
  Referer: "https://dps.psx.com.pk/",
};

export interface PdfDividendDetails {
  /** Per-share rupees parsed from the PDF body (the most reliable figure). */
  dpsFromPdf: number | null;
  /** Percentage of face value, if stated (often cumulative — trust DPS first). */
  percentageFromPdf: number | null;
  bookClosureStart: string | null;
  bookClosureEnd: string | null;
  paymentDate: string | null;
  /** True when the filing confirms the dividend was already credited/paid. */
  isCredited: boolean;
  /** Short body excerpt for auditing/UI. */
  excerpt: string | null;
  /** True only when the PDF was fetched and parsed successfully. */
  parsed: boolean;
}

const EMPTY: PdfDividendDetails = {
  dpsFromPdf: null,
  percentageFromPdf: null,
  bookClosureStart: null,
  bookClosureEnd: null,
  paymentDate: null,
  isCredited: false,
  excerpt: null,
  parsed: false,
};

/** Reject obviously-misparsed years so a stray "(D-12)" never becomes a date. */
function sane(iso: string | null): string | null {
  if (!iso) return null;
  const year = Number(iso.slice(0, 4));
  return year >= 2015 && year <= 2100 ? iso : null;
}

/**
 * Parse PSX-style dates: "25th May 2026", "May 25, 2026", "25-05-2026",
 * "25/05/2026". Requires a real 4-digit year — partial strings return null.
 */
export function parsePsxBodyDate(raw: string): string | null {
  const s = raw.trim().replace(/(\d+)(st|nd|rd|th)/gi, "$1");
  // Must contain a 4-digit year to be trusted at all.
  if (!/\b(19|20)\d{2}\b/.test(s) && !/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s)) return null;

  const dmy = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    const iso = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return sane(Number.isNaN(new Date(iso).getTime()) ? null : iso);
  }
  const direct = new Date(`${s} GMT+0500`);
  return sane(Number.isNaN(direct.getTime()) ? null : direct.toISOString().slice(0, 10));
}

/** Pull the first credible "Rs. X per share" value from PDF body text. */
function extractDps(text: string): number | null {
  // Prefer values explicitly tied to "per share".
  const perShare = text.match(/rs\.?\s*([\d,]+(?:\.\d+)?)\s*\/?-?\s*per\s*share/i);
  if (perShare) {
    const v = parseFloat(perShare[1].replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0 && v < 10_000) return v;
  }
  // Fallback: "Cash Dividend ... Rs. X/-"
  const loose = text.match(/(?:cash\s+dividend|dividend)[^.]{0,40}?rs\.?\s*([\d,]+(?:\.\d+)?)\s*\/?-?/i);
  if (loose) {
    const v = parseFloat(loose[1].replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0 && v < 10_000) return v;
  }
  return null;
}

function extractPercentage(text: string): number | null {
  const m = text.match(/(?:i\.?e\.?|@|=|of)\s*([\d.]+)\s*%/i) ?? text.match(/([\d.]+)\s*%/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v > 0 && v <= 10_000 ? v : null;
}

function extractBookClosure(text: string): { start: string | null; end: string | null } {
  // "Book Closure from 12-06-2026 to 18-06-2026" / "closed from June 12, 2026 to June 18, 2026"
  const range = text.match(
    /book\s*clos(?:ure|ed)?[\s\S]{0,80}?from\s+([A-Za-z0-9,\s/-]{6,24}?)\s+(?:to|till|until|through)\s+([A-Za-z0-9,\s/-]{6,24}?)(?:\.|,|\(|both|\bfor\b|$)/i
  );
  if (range) return { start: parsePsxBodyDate(range[1]), end: parsePsxBodyDate(range[2]) };
  return { start: null, end: null };
}

function extractPaymentDate(text: string): string | null {
  // Only trust an explicit payment phrase that is followed by a full date
  // containing a 4-digit year — avoids grabbing reference codes like "(D-12)".
  const m = text.match(
    /(?:payment|dividend\s+warrants?|will\s+be\s+(?:paid|dispatched|credited))[^.]{0,30}?\bon\b\s*([A-Za-z0-9,\s/-]{6,24}?\b(?:19|20)\d{2}\b)/i
  );
  return m ? parsePsxBodyDate(m[1]) : null;
}

/**
 * Fetch a PSX announcement PDF and extract dividend facts. Returns EMPTY (with
 * parsed=false) on any failure so callers can fall back to title parsing.
 */
export async function extractDividendDetailsFromPdf(url: string): Promise<PdfDividendDetails> {
  if (!/\.pdf(\?|$)/i.test(url)) return EMPTY;
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return EMPTY;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) return EMPTY;

    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const result = await parser.getText();
    await parser.destroy();

    const text = (result.text ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 40) return EMPTY;

    const bc = extractBookClosure(text);
    const credited =
      /\b(has\s+been\s+credited|have\s+been\s+credited|already\s+credited|was\s+credited|dividend\s+credited)\b/i.test(
        text
      );

    return {
      dpsFromPdf: extractDps(text),
      percentageFromPdf: extractPercentage(text),
      bookClosureStart: bc.start,
      bookClosureEnd: bc.end,
      paymentDate: extractPaymentDate(text),
      isCredited: credited,
      excerpt: text.slice(0, 400),
      parsed: true,
    };
  } catch {
    return EMPTY;
  }
}
