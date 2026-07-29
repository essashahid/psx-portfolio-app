/**
 * Verifies PDF extraction works when the runtime lacks DOM globals, which is
 * the condition that silently broke the deployed ingest endpoint (pdfjs threw
 * "DOMMatrix is not defined" inside the Vercel serverless runtime while
 * working fine under plain Node).
 *
 *   npx tsx scripts/verification/verify-pdf-globals.ts <confirmation.pdf>
 */
import { readFileSync } from "fs";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/verification/verify-pdf-globals.ts <pdf>");
    process.exit(1);
  }
  // Simulate the deployed runtime: remove anything pdfjs might lean on.
  const g = globalThis as Record<string, unknown>;
  for (const key of ["DOMMatrix", "Path2D", "ImageData"]) delete g[key];
  console.log("Before: DOMMatrix =", typeof g.DOMMatrix);

  const { extractPdfLayoutText } = await import("../../lib/import/pdf-layout");
  const { parseAkdConfirmation } = await import("../../lib/import/akd-confirmation");
  const text = await extractPdfLayoutText(readFileSync(path));
  const parsed = parseAkdConfirmation(text);
  console.log("After:  DOMMatrix =", typeof (globalThis as Record<string, unknown>).DOMMatrix);
  console.log(`Extracted ${text.length} chars, parsed ${parsed?.trades.length ?? 0} trade(s)`);
  for (const t of parsed?.trades ?? []) {
    console.log(`  ${t.side} ${t.ticker} ${t.quantity} @ ${t.rate} net ${t.net}`);
  }
  process.exit(parsed?.trades.length ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
