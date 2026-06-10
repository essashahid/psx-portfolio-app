import { readFileSync } from "fs";
import { parseFile } from "@/lib/import/parse";
import { suggestMapping, detectStatementType, normalizeRow, validateRow } from "@/lib/import/normalize";
import { rebuildHoldings } from "@/lib/portfolio";

async function testFile(path: string, expectType: string) {
  const buf = readFileSync(path);
  const parsed = await parseFile(buf, path);
  const mapping = suggestMapping(parsed.headers);
  const type = detectStatementType(mapping);
  console.log(`\n=== ${path}`);
  console.log("headers:", parsed.headers.join(" | "));
  console.log("mapping:", JSON.stringify(mapping));
  console.log("detected:", type, type === expectType ? "✓" : `✗ expected ${expectType}`);
  console.log("warnings:", parsed.meta.warnings);
  for (const raw of parsed.rows) {
    const n = normalizeRow(raw, mapping);
    const v = validateRow(n, type);
    console.log(` row: ${JSON.stringify(n)} -> ${v.status} ${v.issues.join("; ")}`);
  }
  return { parsed, mapping, type };
}

(async () => {
  await testFile("samples/sample_holdings_akd.csv", "holdings");
  const trades = await testFile("samples/sample_trades_akd.csv", "trades");
  await testFile("samples/sample_dividends_cdc.csv", "dividends");

  // weighted average rebuild from the trades sample
  const txns = trades.parsed.rows.map((raw) => {
    const n = normalizeRow(raw, trades.mapping);
    return {
      ticker: n.ticker!, trade_date: n.trade_date ?? null, type: n.type!,
      quantity: n.quantity ?? null, price: n.price ?? null,
      gross_amount: n.gross_amount ?? null, commission: n.commission ?? null,
      tax: n.tax ?? null, net_amount: n.net_amount ?? null,
    };
  });
  const { positions } = rebuildHoldings(txns);
  console.log("\n=== rebuilt positions (weighted avg)");
  for (const [t, p] of positions) {
    console.log(` ${t}: qty=${p.quantity} avg=${p.avgCost.toFixed(2)} cost=${p.totalCost.toFixed(2)} realized=${p.realizedPl.toFixed(2)}`);
  }
  // MEBL check: (63409.50 + 45040.88) / 500 = 216.90
  const mebl = positions.get("MEBL")!;
  console.log("MEBL avg cost check:", Math.abs(mebl.avgCost - 216.9) < 0.01 ? "✓" : `✗ got ${mebl.avgCost}`);
  // ENGRO: bought 500 @ net 156007.50 (avg 312.015), sold 100 -> realized = 33282.25 - 31201.50 = 2080.75
  const engro = positions.get("ENGRO")!;
  console.log("ENGRO realized check:", Math.abs(engro.realizedPl - 2080.75) < 0.01 ? "✓" : `✗ got ${engro.realizedPl}`, "qty:", engro.quantity === 400 ? "✓" : `✗ ${engro.quantity}`);
})();
