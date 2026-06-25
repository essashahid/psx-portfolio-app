// Backfills the database ledger from the authoritative AKD statement so the
// DB (transactions + cash_movements) becomes the single source of truth that
// reconciles to the closing inventory. Clean-slate: clears the user's existing
// (partial, inconsistent) transactions + cash_movements first, then loads:
//   - every statement trade (BUY/SELL)
//   - every deposit (CASH_IN) and charge (FEE/TAX)
//   - the 4 confirmed corporate actions, as ledger rows
//   - the 2 genuine post-statement manual buys (24-Jun) the current holdings reflect
// Then recomputes holdings, validates against inventory + manual buys, stores a
// reconciliation checkpoint, and rebuilds the benchmark series.
//
//   npx tsx scripts/backfill-ledger.ts ./COAF5632.PDF --write [--email=you@example.com]

import { readFileSync } from "fs";
import { config } from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseAkdStatement, type AkdStatement } from "@/lib/import/akd-statement";
import { recomputeHoldingsFromTransactions } from "@/lib/portfolio";
import { ensureEodCached } from "@/lib/market-data/eod-cache";
import { rebuildBenchmarkSeries } from "@/lib/engine/benchmark-rebuild";

config({ path: resolve(process.cwd(), ".env.local") });

const UBL_SPLIT_DATE = "2025-06-20";
const FFBL_MERGER_DATE = "2025-01-01"; // cash-neutral; between FFBL buys and FFC activity

type TxnRow = {
  ticker: string; trade_date: string; type: string;
  quantity: number | null; price: number | null;
  commission: number | null; tax: number | null; net_amount: number | null;
  source: string; notes: string | null; row_hash: string;
};
type CashRow = { movement_date: string; type: string; amount: number; description: string; source: string; row_hash: string };

async function extractText(path: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(readFileSync(path)) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text ?? "";
}

function buildRows(stmt: AkdStatement) {
  const txns: TxnRow[] = [];
  const cash: CashRow[] = [];

  // 1. Statement trades.
  stmt.trades.forEach((t, i) => {
    if (!t.date) return;
    txns.push({
      ticker: t.ticker, trade_date: t.date, type: t.side,
      quantity: t.quantity, price: t.price,
      commission: t.commission, tax: t.sst + t.cdc, net_amount: t.net,
      source: "import", notes: null,
      row_hash: `akd-trade-${t.entryNo}-${t.ticker}-${t.date}-${i}`,
    });
  });

  // 2. Deposits + charges.
  stmt.deposits.forEach((d, i) => {
    if (!d.date) return;
    cash.push({ movement_date: d.date, type: "CASH_IN", amount: d.amount, description: d.narration.slice(0, 200), source: "import", row_hash: `akd-deposit-${d.entryNo}-${d.date}-${i}` });
  });
  stmt.charges.forEach((c, i) => {
    if (!c.date) return;
    cash.push({ movement_date: c.date, type: c.kind === "CGT" ? "TAX" : "FEE", amount: c.amount, description: c.narration.slice(0, 200), source: "import", row_hash: `akd-charge-${c.entryNo}-${c.date}-${i}` });
  });

  // 3. Corporate actions as ledger rows.
  // UBL 2:1 split.
  txns.push({ ticker: "UBL", trade_date: UBL_SPLIT_DATE, type: "SPLIT", quantity: 2, price: null, commission: null, tax: null, net_amount: null, source: "adjustment", notes: "UBL 2-for-1 stock split", row_hash: "ca-ubl-split" });
  // FFBL -> FFC merger (100 FFBL -> 23 FFC), cash-neutral, cost transferred.
  const ffblCost = stmt.trades.filter((t) => t.ticker === "FFBL" && t.side === "BUY").reduce((s, t) => s + t.net, 0);
  txns.push({ ticker: "FFBL", trade_date: FFBL_MERGER_DATE, type: "SELL", quantity: 100, price: ffblCost / 100, commission: 0, tax: 0, net_amount: ffblCost, source: "adjustment", notes: "FFBL converted to FFC (merger)", row_hash: "ca-ffbl-merge-out" });
  txns.push({ ticker: "FFC", trade_date: FFBL_MERGER_DATE, type: "BUY", quantity: 23, price: ffblCost / 23, commission: 0, tax: 0, net_amount: ffblCost, source: "adjustment", notes: "FFC received from FFBL merger", row_hash: "ca-ffbl-merge-in" });
  // IREIT IPO allotment (funded externally).
  cash.push({ movement_date: "2025-09-23", type: "CASH_IN", amount: 15000, description: "IREIT IPO allotment funding", source: "adjustment", row_hash: "ca-ireit-fund" });
  txns.push({ ticker: "IREIT", trade_date: "2025-09-23", type: "BUY", quantity: 1500, price: 10, commission: 0, tax: 0, net_amount: 15000, source: "adjustment", notes: "IREIT IPO allotment", row_hash: "ca-ireit-buy" });
  // SLM external acquisition.
  cash.push({ movement_date: "2026-06-15", type: "CASH_IN", amount: 19950, description: "SLM acquisition funding", source: "adjustment", row_hash: "ca-slm-fund" });
  txns.push({ ticker: "SLM", trade_date: "2026-06-15", type: "BUY", quantity: 1000, price: 19.95, commission: 0, tax: 0, net_amount: 19950, source: "adjustment", notes: "SLM acquisition", row_hash: "ca-slm-buy" });

  // 4. Genuine post-statement manual buys (24-Jun), with matching funding so
  // cash stays at the real broker balance.
  const manual = [
    { ticker: "FCCL", quantity: 176, price: 57.80, net: 10191.24 },
    { ticker: "FFC", quantity: 18, price: 557.25, net: 10047.90 },
  ];
  const manualTotal = manual.reduce((s, m) => s + m.net, 0);
  cash.push({ movement_date: "2026-06-24", type: "CASH_IN", amount: manualTotal, description: "Funding for 24 Jun manual purchases", source: "manual", row_hash: "manual-2026-06-24-fund" });
  manual.forEach((m, i) => {
    txns.push({ ticker: m.ticker, trade_date: "2026-06-24", type: "BUY", quantity: m.quantity, price: m.price, commission: 0, tax: 0, net_amount: m.net, source: "manual", notes: "Manual purchase after statement period", row_hash: `manual-2026-06-24-${m.ticker}-${i}` });
  });

  return { txns, cash };
}

/** Expected current holdings = statement inventory + the 2 post-statement manual buys. */
function expectedHoldings(stmt: AkdStatement): Map<string, number> {
  const m = new Map<string, number>();
  for (const inv of stmt.inventory) m.set(inv.ticker, inv.quantity);
  m.set("FCCL", (m.get("FCCL") ?? 0) + 176);
  m.set("FFC", (m.get("FFC") ?? 0) + 18);
  return m;
}

async function resolveUserId(s: SupabaseClient, email?: string): Promise<string | null> {
  if (email) {
    const { data } = await s.auth.admin.listUsers();
    return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  }
  const { data } = await s.from("holdings").select("user_id").limit(1).maybeSingle();
  return data?.user_id ?? null;
}

async function main() {
  const path = process.argv[2];
  if (!path) { console.error("Pass the AKD PDF path."); process.exit(2); }
  const write = process.argv.includes("--write");
  const email = process.argv.find((a) => a.startsWith("--email="))?.split("=")[1];

  const stmt = parseAkdStatement(await extractText(path));
  if (!stmt) { console.error("Not an AKD statement."); process.exit(1); }

  const { txns, cash } = buildRows(stmt);
  console.log(`Built ${txns.length} transactions + ${cash.length} cash movements.`);

  if (!write) { console.log("Dry run. Re-run with --write to persist."); return; }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const userId = await resolveUserId(supabase, email);
  if (!userId) throw new Error("Could not resolve user_id (pass --email=).");

  // Clean slate, then load the authoritative ledger.
  await supabase.from("transactions").delete().eq("user_id", userId);
  await supabase.from("cash_movements").delete().eq("user_id", userId);
  const insTxn = await supabase.from("transactions").insert(txns.map((t) => ({ ...t, user_id: userId })));
  if (insTxn.error) throw insTxn.error;
  const insCash = await supabase.from("cash_movements").insert(cash.map((c) => ({ ...c, user_id: userId })));
  if (insCash.error) throw insCash.error;

  await recomputeHoldingsFromTransactions(supabase, userId);

  // Validate against expected current holdings.
  const expected = expectedHoldings(stmt);
  const { data: holdings } = await supabase.from("holdings").select("ticker, quantity").eq("user_id", userId);
  const got = new Map((holdings ?? []).map((h) => [h.ticker as string, Number(h.quantity)]));
  console.log("\n=== Reconciliation: recomputed holdings vs expected (inventory + manual) ===");
  let ok = true;
  for (const [ticker, qty] of [...expected.entries()].sort()) {
    const g = Math.round(got.get(ticker) ?? 0);
    const flag = g === qty ? "ok" : "MISMATCH";
    if (g !== qty) ok = false;
    console.log(`  ${ticker.padEnd(8)} recomputed ${String(g).padStart(6)}  expected ${String(qty).padStart(6)}  ${flag}`);
  }
  console.log(ok ? "\nHoldings reconcile." : "\n! Holdings mismatch — review before relying on this.");

  // Store the statement inventory as the reconciliation checkpoint.
  const checkpoint = {
    items: stmt.inventory.map((i) => ({ ticker: i.ticker, quantity: i.quantity, closingRate: i.closingRate })),
    totalShares: stmt.inventory.reduce((s, i) => s + i.quantity, 0),
    ledgerBalance: stmt.controls.ledgerBalance,
    netWorth: stmt.controls.netWorth,
    manualPurchases: [{ ticker: "FCCL", quantity: 176 }, { ticker: "FFC", quantity: 18 }],
  };
  await supabase.from("reconciliation_checkpoints").upsert(
    { user_id: userId, as_of: stmt.account.toDate ?? "2026-07-01", source: "akd_statement", data: checkpoint },
    { onConflict: "user_id,as_of,source" }
  );

  // Warm EOD cache + rebuild benchmark from the new ledger.
  console.log("\nWarming EOD cache + rebuilding benchmark...");
  const tickers = [...new Set(txns.map((t) => t.ticker))];
  await ensureEodCached(tickers);
  const bench = await rebuildBenchmarkSeries(supabase, userId);
  console.log(`Benchmark points: ${bench?.points ?? 0}`);
  console.log(`\nBackfill complete for user ${userId}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
