// Reconcile the ledger-derived cash balance against a real AKD statement.
//
// Usage: npx tsx scripts/verification/reconcile-cash.ts <statement.pdf> <user-id>
//
// Parses the statement, reads its own closing ledger balance, computes the
// account's cash from transactions and cash_movements dated on or before the
// statement's end date using the same function the dashboard uses, and prints
// the difference. Exits non-zero when they disagree by more than one rupee.
// Read-only.

import { readFileSync } from "fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { parseAkdStatement, reconcileAkd } from "@/lib/import/akd-statement";
import { computeCashBalance } from "@/lib/portfolio/cash";

config({ path: ".env.local" });

async function extractText(path: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(path)) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text ?? "";
}

async function main() {
  const [path, userId] = process.argv.slice(2);
  if (!path || !userId) {
    console.error("Usage: reconcile-cash.ts <statement.pdf> <user-id>");
    process.exit(2);
  }
  const stmt = parseAkdStatement(await extractText(path));
  if (!stmt) {
    console.error("Not recognised as an AKD Statement Of Account.");
    process.exit(1);
  }
  const rec = reconcileAkd(stmt);
  const asOf = stmt.account.toDate;
  console.log(`Statement ${stmt.account.coaf} ${stmt.account.fromDate} to ${asOf}`);
  console.log(`Statement's own ledger: computed ${rec.cash.computedBalance} vs stated ${rec.cash.statedBalance} (${rec.cash.matches ? "match" : "MISMATCH"})`);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const [{ data: cash, error: cashErr }, { data: txns, error: txnErr }] = await Promise.all([
    supabase.from("cash_movements").select("type, amount, date:movement_date").eq("user_id", userId),
    supabase.from("transactions").select("type, net_amount, trade_date").eq("user_id", userId),
  ]);
  if (cashErr || txnErr) throw cashErr ?? txnErr;
  const ledgerAtEnd = computeCashBalance(cash ?? [], txns ?? [], asOf);
  const ledgerNow = computeCashBalance(cash ?? [], txns ?? []);
  const stated = rec.cash.statedBalance;
  const diff = stated === null ? null : Math.round((ledgerAtEnd - stated) * 100) / 100;

  console.log(`App cash as of ${asOf}: ${ledgerAtEnd.toFixed(2)}   (now: ${ledgerNow.toFixed(2)})`);
  console.log(`Statement closing balance: ${stated === null ? "not printed" : stated.toFixed(2)}`);
  console.log(`Difference: ${diff === null ? "n/a" : diff.toFixed(2)}`);
  console.log(`Rows counted: ${(cash ?? []).filter((c) => !c.date || c.date <= asOf).length} cash movements, ${(txns ?? []).filter((t) => !t.trade_date || t.trade_date <= asOf).length} transactions`);
  if (diff !== null && Math.abs(diff) > 1) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
