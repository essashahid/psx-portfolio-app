// Backfills the virtual ledger (transactions + cash_movements) for
// esmailshahid@gmail.com from the CFSD1611 "Statement Of Account" screens.
//
// Context: this user's holdings already exist as statement_snapshot rows and
// match the statement to the cent, but transactions + cash_movements are empty
// so the virtual ledger and derived cash are blank. This loads the full ledger:
//   - 3 Raast deposits (CASH_IN, total 225,000)
//   - 2 non-trade debits: Balance B/F (3,610.50) + UIN annual fee (300) as FEE
//   - 16 T+1 BUY fills across 5 voucher batches
//   - 2 transferred-in positions (CCM, PINL) as ADJUST rows carrying their
//     existing cost basis, with NO cash impact (they were transferred, not
//     bought, so they never hit the broker cash ledger)
// then recomputes holdings (preserving company_name/sector, since ENGROH/CCM/PINL
// are absent from stock_master) and verifies the ledger closes at PKR 4,467.49.
//
//   npx tsx scripts/backfill-esmail-ledger.ts          # dry run
//   npx tsx scripts/backfill-esmail-ledger.ts --write   # persist

import { config } from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recomputeHoldingsFromTransactions } from "@/lib/portfolio";

config({ path: resolve(process.cwd(), ".env.local") });

const EMAIL = "esmailshahid@gmail.com";
const HASH_PREFIX = "cfsd1611"; // namespaced so re-runs are idempotent
const EXPECTED_CLOSING = 4467.49;

type Buy = {
  ticker: string; date: string; qty: number; price: number;
  comm: number; cdc: number; cvt: number; sst: number; net: number; voucher: string;
};

// Transcribed from the CFSD1611 Account Statement (Jun 28 2025 – Jun 28 2026).
const BUYS: Buy[] = [
  // Voucher CV030133 — 30 Mar 2026
  { ticker: "FFC",     date: "2026-03-30", qty: 30,  price: 501.50, comm: 22.57, cdc: 0.15, cvt: 0, sst: 3.39, net: 15071.10, voucher: "CV030133" },
  { ticker: "MEBL",    date: "2026-03-30", qty: 44,  price: 458.20, comm: 30.24, cdc: 0.22, cvt: 0, sst: 4.54, net: 20195.80, voucher: "CV030133" },
  { ticker: "SYS",     date: "2026-03-30", qty: 72,  price: 139.25, comm: 15.04, cdc: 0.36, cvt: 0, sst: 2.26, net: 10043.70, voucher: "CV030133" },
  { ticker: "UBL",     date: "2026-03-30", qty: 59,  price: 340.50, comm: 30.14, cdc: 0.30, cvt: 0, sst: 4.52, net: 20124.50, voucher: "CV030133" },
  // Voucher CV040031 — 07 Apr 2026
  { ticker: "UBL",     date: "2026-04-07", qty: 32,  price: 308.50, comm: 14.81, cdc: 0.16, cvt: 0, sst: 2.22, net: 9889.19,  voucher: "CV040031" },
  // Voucher CV040122 — 27 Apr 2026
  { ticker: "LUCK",    date: "2026-04-27", qty: 47,  price: 422.28, comm: 29.77, cdc: 0.24, cvt: 0, sst: 4.47, net: 19881.50, voucher: "CV040122" },
  { ticker: "MEBL",    date: "2026-04-27", qty: 20,  price: 494.11, comm: 14.82, cdc: 0.10, cvt: 0, sst: 2.22, net: 9899.34,  voucher: "CV040122" },
  { ticker: "PPL",     date: "2026-04-27", qty: 35,  price: 233.20, comm: 12.24, cdc: 0.18, cvt: 0, sst: 1.84, net: 8176.26,  voucher: "CV040122" },
  { ticker: "UBL",     date: "2026-04-27", qty: 35,  price: 418.55, comm: 21.97, cdc: 0.18, cvt: 0, sst: 3.30, net: 14674.70, voucher: "CV040122" },
  // Voucher CV050078 — 19 May 2026
  { ticker: "AIRLINK", date: "2026-05-19", qty: 108, price: 139.18, comm: 22.55, cdc: 0.54, cvt: 0, sst: 3.38, net: 15057.90, voucher: "CV050078" },
  // Voucher CV060010 — 02 Jun 2026
  { ticker: "ENGROH",  date: "2026-06-02", qty: 55,  price: 271.56, comm: 22.40, cdc: 0.28, cvt: 0, sst: 3.36, net: 14961.80, voucher: "CV060010" },
  { ticker: "FFC",     date: "2026-06-02", qty: 27,  price: 563.50, comm: 22.82, cdc: 0.14, cvt: 0, sst: 3.42, net: 15240.90, voucher: "CV060010" },
  { ticker: "HUBC",    date: "2026-06-02", qty: 46,  price: 218.26, comm: 15.06, cdc: 0.23, cvt: 0, sst: 2.26, net: 10057.50, voucher: "CV060010" },
  { ticker: "OGDC",    date: "2026-06-02", qty: 25,  price: 325.40, comm: 12.20, cdc: 0.13, cvt: 0, sst: 1.83, net: 8149.16,  voucher: "CV060010" },
  { ticker: "PPL",     date: "2026-06-02", qty: 43,  price: 235.15, comm: 15.17, cdc: 0.22, cvt: 0, sst: 2.27, net: 10129.10, voucher: "CV060010" },
  { ticker: "UBL",     date: "2026-06-02", qty: 37,  price: 406.58, comm: 22.57, cdc: 0.19, cvt: 0, sst: 3.38, net: 15069.60, voucher: "CV060010" },
];

const DEPOSITS = [
  { date: "2026-03-26", amount: 100000, voucher: "RV323899", desc: "RECD-RAAST - PK73CDCP5050199900042052 (CFSD1611)" },
  { date: "2026-04-24", amount: 50000,  voucher: "RV380497", desc: "RECD-RAAST - PK73CDCP5050199900042052 (CFSD1611)" },
  { date: "2026-06-01", amount: 75000,  voucher: "RV434566", desc: "RECD-RAAST - PK73CDCP5050199900042052 (CFSD1611)" },
];

const CHARGES = [
  { date: "2025-07-01", amount: 3610.50, voucher: "0V000001", desc: "Balance B/F" },
  { date: "2026-01-14", amount: 300.00,  voucher: "GV010012", desc: "UIN Annual Maintenance Renewal Fee 2025-26" },
];

// Positions transferred into the account (not bought here): no cash impact,
// carried at their existing cost basis. Dated at the statement period start so
// they read as opening positions in the virtual ledger.
const TRANSFERS = [
  { ticker: "CCM",  date: "2025-06-28", qty: 27000, cost: 785970.00,  price: 29.11 },
  { ticker: "PINL", date: "2025-06-28", qty: 37977, cost: 220646.37,  price: 5.81 },
];

function buildRows() {
  const txns = [
    ...TRANSFERS.map((t, i) => ({
      ticker: t.ticker, trade_date: t.date, type: "ADJUST",
      quantity: t.qty, price: t.price,
      gross_amount: t.cost, commission: 0, tax: 0, net_amount: t.cost,
      source: "adjustment",
      notes: `Transferred in: ${t.qty} ${t.ticker} (not a market purchase)`,
      row_hash: `${HASH_PREFIX}-transfer-${t.ticker}-${i}`,
    })),
    ...BUYS.map((b, i) => ({
      ticker: b.ticker, trade_date: b.date, type: "BUY",
      quantity: b.qty, price: b.price,
      gross_amount: Math.round(b.qty * b.price * 100) / 100,
      commission: b.comm, tax: Math.round((b.cdc + b.cvt + b.sst) * 100) / 100,
      net_amount: b.net, source: "import",
      notes: `${b.voucher} · T+1 Buy ${b.ticker} ${b.qty} @ ${b.price}`,
      row_hash: `${HASH_PREFIX}-buy-${b.voucher}-${b.ticker}-${b.date}-${i}`,
    })),
  ];
  const cash = [
    ...DEPOSITS.map((d, i) => ({
      movement_date: d.date, type: "CASH_IN", amount: d.amount,
      description: d.desc, source: "import",
      row_hash: `${HASH_PREFIX}-dep-${d.voucher}-${i}`,
    })),
    ...CHARGES.map((c, i) => ({
      movement_date: c.date, type: "FEE", amount: c.amount,
      description: c.desc, source: "import",
      row_hash: `${HASH_PREFIX}-fee-${c.voucher}-${i}`,
    })),
  ];
  return { txns, cash };
}

function expectedHoldings(): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of BUYS) m.set(b.ticker, (m.get(b.ticker) ?? 0) + b.qty);
  for (const t of TRANSFERS) m.set(t.ticker, (m.get(t.ticker) ?? 0) + t.qty);
  return m;
}

async function resolveUserId(s: SupabaseClient): Promise<string> {
  const { data } = await s.auth.admin.listUsers();
  const u = data.users.find((x) => x.email?.toLowerCase() === EMAIL.toLowerCase());
  if (!u) throw new Error(`No user for ${EMAIL}`);
  return u.id;
}

async function main() {
  const write = process.argv.includes("--write");
  const { txns, cash } = buildRows();

  // Reconcile the ledger arithmetic before touching anything.
  const credits = cash.filter((c) => c.type === "CASH_IN").reduce((s, c) => s + c.amount, 0);
  const debits =
    cash.filter((c) => c.type !== "CASH_IN").reduce((s, c) => s + c.amount, 0) +
    txns.filter((t) => t.type === "BUY").reduce((s, t) => s + t.net_amount, 0);
  const closing = Math.round((credits - debits) * 100) / 100;
  console.log(`Credits ${credits.toFixed(2)}  Debits ${debits.toFixed(2)}  Closing ${closing.toFixed(2)} (expected ${EXPECTED_CLOSING})`);
  const reconciles = Math.abs(closing - EXPECTED_CLOSING) < 1;
  console.log(reconciles ? "Ledger reconciles to broker balance." : "! Ledger does NOT reconcile — fix before writing.");
  console.log(`Built ${txns.length} transactions + ${cash.length} cash movements.`);

  if (!write) { console.log("\nDry run. Re-run with --write to persist."); return; }
  if (!reconciles) throw new Error("Refusing to write: ledger does not reconcile.");

  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const userId = await resolveUserId(s);

  // Preserve company_name/sector — ENGROH/CCM/PINL are absent from stock_master,
  // so recompute would otherwise null them.
  const { data: priorHoldings } = await s.from("holdings").select("ticker, company_name, sector").eq("user_id", userId);
  const meta = new Map((priorHoldings ?? []).map((h) => [h.ticker as string, { company_name: h.company_name, sector: h.sector }]));

  // Idempotent: clear any prior rows from this backfill, then insert.
  await s.from("transactions").delete().eq("user_id", userId).like("row_hash", `${HASH_PREFIX}-%`);
  await s.from("cash_movements").delete().eq("user_id", userId).like("row_hash", `${HASH_PREFIX}-%`);
  const insT = await s.from("transactions").insert(txns.map((t) => ({ ...t, user_id: userId })));
  if (insT.error) throw insT.error;
  const insC = await s.from("cash_movements").insert(cash.map((c) => ({ ...c, user_id: userId })));
  if (insC.error) throw insC.error;

  await recomputeHoldingsFromTransactions(s, userId);

  // Restore company_name/sector for ledger tickers where recompute lost them.
  for (const ticker of expectedHoldings().keys()) {
    const m = meta.get(ticker);
    if (m && (m.company_name || m.sector)) {
      await s.from("holdings").update({ company_name: m.company_name, sector: m.sector }).eq("user_id", userId).eq("ticker", ticker);
    }
  }

  // Verify recomputed holdings match the statement quantities.
  const expected = expectedHoldings();
  const { data: holdings } = await s.from("holdings").select("ticker, quantity, avg_cost").eq("user_id", userId);
  const got = new Map((holdings ?? []).map((h) => [h.ticker as string, Number(h.quantity)]));
  console.log("\n=== Reconciliation: recomputed vs statement quantities ===");
  let ok = true;
  for (const [ticker, qty] of [...expected.entries()].sort()) {
    const g = Math.round(got.get(ticker) ?? 0);
    if (g !== qty) ok = false;
    console.log(`  ${ticker.padEnd(8)} recomputed ${String(g).padStart(6)}  expected ${String(qty).padStart(6)}  ${g === qty ? "ok" : "MISMATCH"}`);
  }
  console.log(ok ? "Holdings reconcile." : "! Holdings mismatch.");
  console.log(`Preserved (not in statement): ${(holdings ?? []).map((h) => h.ticker).filter((t) => !expected.has(t)).join(", ")}`);
  console.log(`\nBackfill complete for ${EMAIL} (${userId}).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
