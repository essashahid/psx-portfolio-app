// Sanity test for the AKD Statement Of Account parser.
// Usage: npx tsx scripts/test-akd-statement.ts /path/to/COAF5632.PDF
//
// Parses the PDF, prints the reconciliation against the statement's own
// control totals and Inventory Position, and exits non-zero if the cash
// ledger does not reconcile to the cent.

import { readFileSync } from "fs";
import { parseAkdStatement, akdToImportRows, reconcileAkd } from "@/lib/import/akd-statement";

async function extractText(path: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const buffer = readFileSync(path);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text ?? "";
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Pass the path to an AKD statement PDF.");
    process.exit(2);
  }

  const text = await extractText(path);
  const stmt = parseAkdStatement(text);
  if (!stmt) {
    console.error("Not recognized as an AKD Statement Of Account.");
    process.exit(1);
  }

  console.log("Account:", stmt.account.coaf, stmt.account.name, "| CDC", stmt.account.cdcId);
  console.log("Period:", stmt.account.fromDate, "->", stmt.account.toDate);
  console.log(
    `Entries: ${stmt.entries.length} | trades ${stmt.trades.length} | deposits ${stmt.deposits.length} | charges ${stmt.charges.length} | inventory ${stmt.inventory.length}`
  );
  if (stmt.warnings.length) console.log("Warnings:", stmt.warnings);

  const importRows = akdToImportRows(stmt);
  console.log(`\nImport rows emitted: ${importRows.rows.length} (headers: ${importRows.headers.join(", ")})`);

  const rec = reconcileAkd(stmt);

  console.log("\n=== CASH RECONCILE ===");
  console.log(
    `deposits ${rec.cash.deposits}  sells ${rec.cash.sells}  buys ${rec.cash.buys}  cgt ${rec.cash.cgt}  fees ${rec.cash.fees}`
  );
  console.log(
    `computed balance ${rec.cash.computedBalance}  |  stated ${rec.cash.statedBalance}  |  diff ${rec.cash.difference}  |  ${rec.cash.matches ? "MATCH" : "MISMATCH"}`
  );

  console.log("\n=== HOLDINGS RECONCILE (rebuilt vs Inventory Position) ===");
  for (const h of rec.holdings) {
    const flag = h.difference ? `DIFF ${h.difference}` : "ok";
    console.log(
      `${h.ticker.padEnd(8)} rebuilt ${String(h.rebuiltQty).padStart(6)}  inv ${String(h.statedQty ?? "-").padStart(6)}  ${flag.padEnd(10)} ${h.avgCost ? "avg " + h.avgCost : ""} ${h.note ?? ""}`
    );
  }

  console.log("\n=== REALIZED P/L ===");
  for (const r of rec.realizedPl) console.log(`${r.ticker.padEnd(8)} ${r.amount}`);
  console.log("total realized P/L:", rec.totalRealizedPl);
  console.log("total trade fees (comm+SST+CDC):", rec.totalTradeFees);

  if (!rec.cash.matches) {
    console.error("\nFAIL: cash ledger did not reconcile to the statement balance.");
    process.exit(1);
  }
  console.log("\nPASS: cash ledger reconciles to the statement balance.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
