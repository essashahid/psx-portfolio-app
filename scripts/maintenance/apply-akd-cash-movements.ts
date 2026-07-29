/**
 * Records AKD cash movements (deposits, withdrawals, account charges) that the
 * email confirmations cannot supply.
 *
 * Trade confirmations cover fills only, so deposits and charges have to come
 * from the AKD app's Account Statement. Enter them in MOVEMENTS below, taken
 * straight off that screen, and run:
 *
 *   npx tsx scripts/maintenance/apply-akd-cash-movements.ts            # dry run
 *   npx tsx scripts/maintenance/apply-akd-cash-movements.ts --apply
 *
 * Each row gets a deterministic row_hash built from date, type and amount, so
 * re-running never double-counts and rows already present are reported as
 * skipped. Dates are the AKD ledger dates.
 *
 * After applying, the app's closing cash balance should equal the "Ledger
 * Balance" shown in the AKD app; the script prints both so any drift is
 * visible immediately.
 */
import { createHash } from "crypto";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

interface Movement {
  date: string; // ISO
  type: "CASH_IN" | "CASH_OUT" | "FEE" | "TAX";
  amount: number; // always positive
  description: string;
}

// From the AKD app, Account Statement, 1 Jul 2026 - 29 Jul 2026.
// The 1 Jul and 6 Jul deposits were already in the ledger and are omitted.
const MOVEMENTS: Movement[] = [
  { date: "2026-07-09", type: "CASH_IN", amount: 20000, description: "RECD-RAAST - PK04CDCP5050199900027289 (COAF5632) RV018188" },
  { date: "2026-07-14", type: "CASH_IN", amount: 20000, description: "RECD-RAAST - PK04CDCP5050199900027289 (COAF5632) RV026379" },
  { date: "2026-07-17", type: "FEE", amount: 300, description: "UIN ANNUAL MAINTENANCE CHARGES 2025-26 GV070017" },
  { date: "2026-07-23", type: "CASH_IN", amount: 50000, description: "RECD-RAAST - PK04CDCP5050199900027289 (COAF5632) RV045094" },
  // Pre-July drift. AKD's 1 Jul statement opens with Balance B/F 241.75; the
  // ledger's own June closing is slightly higher because cash before July was
  // reconstructed from statement imports and hand-entered funding rather than
  // the movement-by-movement record. One dated entry absorbs that gap so the
  // closing balance matches the broker exactly.
  { date: "2026-06-30", type: "CASH_OUT", amount: 239.18, description: "Opening reconciliation to AKD Balance B/F 241.75 at 1 Jul 2026" },
];

// The AKD app's headline "Ledger Balance" at the time these were captured.
const AKD_LEDGER_BALANCE = 40525.0;

async function main() {
  const userId = process.env.EMAIL_INGEST_USER_ID;
  if (!userId) throw new Error("EMAIL_INGEST_USER_ID missing");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const hashOf = (m: Movement) =>
    createHash("sha256")
      .update(`akdcash-${userId.slice(0, 8)}-${m.date}-${m.type}-${Math.round(m.amount * 100)}`)
      .digest("hex");

  const hashes = MOVEMENTS.map(hashOf);
  const { data: existing } = await s
    .from("cash_movements")
    .select("row_hash")
    .eq("user_id", userId)
    .in("row_hash", hashes);
  const seen = new Set((existing ?? []).map((r) => r.row_hash as string));

  const toInsert = MOVEMENTS.filter((_, i) => !seen.has(hashes[i]));
  console.log(`${MOVEMENTS.length} movement(s) defined, ${MOVEMENTS.length - toInsert.length} already present.`);
  for (const m of toInsert) {
    const sign = m.type === "CASH_IN" ? "+" : "-";
    console.log(`  ${m.date}  ${sign}${m.amount.toFixed(2)}  ${m.type}  ${m.description.slice(0, 60)}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these movements.");
    return;
  }

  for (let i = 0; i < MOVEMENTS.length; i++) {
    const m = MOVEMENTS[i];
    if (seen.has(hashes[i])) continue;
    const { error } = await s.from("cash_movements").insert({
      user_id: userId,
      movement_date: m.date,
      type: m.type,
      amount: m.amount,
      description: m.description,
      row_hash: hashes[i],
    });
    if (error) throw error;
  }
  console.log(`\nInserted ${toInsert.length} movement(s).`);

  // Closing balance the app will show: deposits and sale proceeds credit,
  // buys, fees, taxes and withdrawals debit.
  const { data: txns } = await s
    .from("transactions")
    .select("type, net_amount")
    .eq("user_id", userId);
  const { data: cash } = await s
    .from("cash_movements")
    .select("type, amount")
    .eq("user_id", userId);

  let balance = 0;
  for (const t of txns ?? []) {
    const net = Number(t.net_amount ?? 0);
    if (t.type === "BUY" || t.type === "RIGHT") balance -= net;
    else if (t.type === "SELL") balance += net;
  }
  for (const c of cash ?? []) {
    const amt = Math.abs(Number(c.amount ?? 0));
    balance += c.type === "CASH_IN" || c.type === "DIVIDEND" ? amt : -amt;
  }
  balance = Math.round(balance * 100) / 100;
  console.log(`\nApp closing cash balance: ${balance.toFixed(2)}`);
  console.log(`AKD ledger balance:       ${AKD_LEDGER_BALANCE.toFixed(2)}`);
  console.log(`Drift:                    ${(Math.round((balance - AKD_LEDGER_BALANCE) * 100) / 100).toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
