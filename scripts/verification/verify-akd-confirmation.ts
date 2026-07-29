/**
 * Verifies the AKD trade-confirmation parser against a real PDF from
 * confirmation@akdsl.com, without touching the database.
 *
 *   npx tsx scripts/verification/verify-akd-confirmation.ts ~/Downloads/COAF5632.pdf
 *
 * Prints the raw pdf-parse text (so parser regressions can be diagnosed by
 * eye) followed by the parsed account, date, per-trade fields and any rows the
 * parser refused to reconcile. Run this on the first real confirmation before
 * trusting the email pipeline; adjust lib/import/akd-confirmation.ts until
 * every genuine fill is extracted and reconciles.
 */
import { readFileSync } from "fs";
import { parseAkdConfirmation } from "../../lib/import/akd-confirmation";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/verification/verify-akd-confirmation.ts <confirmation.pdf>");
    process.exit(1);
  }
  const buffer = readFileSync(path);
  let text = "";
  try {
    const { extractPdfLayoutText } = await import("../../lib/import/pdf-layout");
    text = await extractPdfLayoutText(buffer);
    console.log("===== RAW TEXT (layout rows) =====");
  } catch (err) {
    console.log(`(layout extraction failed: ${err instanceof Error ? err.message : err})`);
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    text = result.text ?? "";
    console.log("===== RAW TEXT (pdf-parse stream fallback) =====");
  }
  console.log(text);
  console.log("===== PARSED =====");

  const parsed = parseAkdConfirmation(text);
  if (!parsed) {
    console.log("Not recognized as an AKD trade confirmation.");
    process.exit(2);
  }
  console.log(`Account:    ${parsed.account ?? "(none)"}`);
  console.log(`Trade date: ${parsed.tradeDate ?? "(none)"}`);
  console.log(`Trades:     ${parsed.trades.length}`);
  for (const t of parsed.trades) {
    const charges = [
      t.commission != null ? `comm ${t.commission}` : null,
      t.tax != null ? `tax ${t.tax}` : null,
      t.cdc != null ? `cdc ${t.cdc}` : null,
      t.net != null ? `net ${t.net}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `  ${t.side.padEnd(4)} ${t.ticker.padEnd(8)} ${String(t.quantity).padStart(8)} @ ${t.rate}  gross ${t.gross}${charges ? `  (${charges})` : ""}`
    );
  }
  if (parsed.warnings.length) {
    console.log("Warnings:");
    for (const w of parsed.warnings) console.log(`  - ${w}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
