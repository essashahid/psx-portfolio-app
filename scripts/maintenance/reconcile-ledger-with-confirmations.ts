/**
 * Reconciles the transactions ledger against the AKD trade-confirmation PDFs
 * stored by the email ingest.
 *
 * The confirmations are the authoritative record of every fill: exact trade
 * date, quantity, rate and the commission / sales tax / CDC split. Rows the
 * user typed by hand (source 'manual') or that arrived through a statement
 * import carry approximations, and statement rows are often dated by
 * settlement rather than execution. This script rewrites those rows in place
 * from the confirmations, inserts fills that never made it in, and reports
 * ledger rows in the window that no confirmation explains.
 *
 *   npx tsx scripts/maintenance/reconcile-ledger-with-confirmations.ts          # dry run
 *   npx tsx scripts/maintenance/reconcile-ledger-with-confirmations.ts --apply
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * EMAIL_INGEST_USER_ID from .env.local. Matching is by ticker, side and
 * quantity within a few days, so a row is only ever rewritten when the
 * confirmation clearly describes the same fill.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { extractPdfLayoutText } from "../../lib/import/pdf-layout";
import { parseAkdConfirmation, type AkdConfirmationTrade } from "../../lib/import/akd-confirmation";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const MATCH_DAYS = 4;
// Rows the confirmations are allowed to rewrite. Statement imports carry
// settlement dates and rounded charges; manual rows are typed from memory.
const REWRITABLE = new Set(["manual", "import", "adjustment"]);

interface LedgerRow {
  id: string;
  trade_date: string | null;
  ticker: string;
  type: string;
  quantity: number | null;
  price: number | null;
  commission: number | null;
  tax: number | null;
  net_amount: number | null;
  source: string;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysApart(a: string, b: string): number {
  return Math.abs(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000
  );
}

async function main() {
  const userId = process.env.EMAIL_INGEST_USER_ID;
  if (!userId) throw new Error("EMAIL_INGEST_USER_ID missing");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Authoritative fills from every stored confirmation PDF.
  const { data: stmts, error: stmtErr } = await s
    .from("uploaded_statements")
    .select("id, file_name, storage_path, status")
    .eq("user_id", userId)
    .in("status", ["email_committed", "email_review"])
    .not("storage_path", "is", null);
  if (stmtErr) throw stmtErr;

  const fills: (AkdConfirmationTrade & { tradeDate: string })[] = [];
  const unreadable: string[] = [];
  for (const row of stmts ?? []) {
    const { data: blob } = await s.storage.from("statements").download(row.storage_path!);
    if (!blob) {
      unreadable.push(`${row.file_name} (download failed)`);
      continue;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    let parsed = null;
    try {
      parsed = parseAkdConfirmation(await extractPdfLayoutText(buffer));
    } catch {
      parsed = null;
    }
    if (!parsed?.trades.length || !parsed.tradeDate) {
      unreadable.push(`${row.file_name} (${row.storage_path})`);
      continue;
    }
    for (const t of parsed.trades) fills.push({ ...t, tradeDate: parsed.tradeDate });
  }
  fills.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.ticker.localeCompare(b.ticker));
  console.log(`Authoritative fills from ${stmts?.length ?? 0} confirmation(s): ${fills.length}`);
  if (unreadable.length) {
    console.log(`Could not parse ${unreadable.length} file(s):`);
    for (const u of unreadable) console.log(`  ${u}`);
  }
  if (!fills.length) return;

  // 2. Ledger rows across the confirmations' date range, widened for
  //    settlement-dated statement rows.
  const from = shiftDate(fills[0].tradeDate, -MATCH_DAYS);
  const to = shiftDate(fills[fills.length - 1].tradeDate, MATCH_DAYS);
  const { data: ledger, error: ledErr } = await s
    .from("transactions")
    .select("id, trade_date, ticker, type, quantity, price, commission, tax, net_amount, source")
    .eq("user_id", userId)
    .gte("trade_date", from)
    .lte("trade_date", to)
    .order("trade_date");
  if (ledErr) throw ledErr;
  const rows = (ledger ?? []) as LedgerRow[];
  console.log(`Ledger rows in ${from} .. ${to}: ${rows.length}\n`);

  // 3. Match each fill to at most one ledger row: same ticker, side and
  //    quantity, nearest date within the window. Each row matches once.
  const claimed = new Set<string>();
  const updates: { row: LedgerRow; fill: (typeof fills)[number]; changes: string[] }[] = [];
  const inserts: (typeof fills)[number][] = [];

  for (const fill of fills) {
    const candidates = rows
      .filter(
        (r) =>
          !claimed.has(r.id) &&
          r.ticker === fill.ticker &&
          r.type === fill.side &&
          Number(r.quantity) === fill.quantity &&
          r.trade_date !== null &&
          daysApart(r.trade_date, fill.tradeDate) <= MATCH_DAYS
      )
      .sort((a, b) => daysApart(a.trade_date!, fill.tradeDate) - daysApart(b.trade_date!, fill.tradeDate));
    const match = candidates[0];
    if (!match) {
      inserts.push(fill);
      continue;
    }
    claimed.add(match.id);
    if (match.source === "email_confirmation") continue; // already authoritative
    if (!REWRITABLE.has(match.source)) {
      console.log(
        `  SKIP (source '${match.source}' not rewritable): ${match.trade_date} ${match.ticker} x${match.quantity}`
      );
      continue;
    }

    const charges = (fill.commission ?? 0) + (fill.tax ?? 0) + (fill.cdc ?? 0);
    const net =
      fill.net ?? (fill.side === "BUY" ? fill.gross + charges : fill.gross - charges);
    const changes: string[] = [];
    if (match.trade_date !== fill.tradeDate) changes.push(`date ${match.trade_date} -> ${fill.tradeDate}`);
    if (Math.abs(Number(match.price ?? 0) - fill.rate) > 0.005)
      changes.push(`price ${match.price} -> ${fill.rate}`);
    if (Math.abs(Number(match.commission ?? 0) - (fill.commission ?? 0)) > 0.005)
      changes.push(`comm ${match.commission} -> ${fill.commission}`);
    if (Math.abs(Number(match.tax ?? 0) - (fill.tax ?? 0)) > 0.005)
      changes.push(`tax ${match.tax} -> ${fill.tax}`);
    if (Math.abs(Number(match.net_amount ?? 0) - net) > 0.005)
      changes.push(`net ${match.net_amount} -> ${Math.round(net * 100) / 100}`);
    changes.push(`source ${match.source} -> email_confirmation`);
    updates.push({ row: match, fill, changes });
  }

  const unexplained = rows.filter((r) => !claimed.has(r.id));

  console.log(`Rewrite ${updates.length} row(s) from confirmations:`);
  for (const u of updates) {
    console.log(`  ${u.row.trade_date} ${u.row.ticker} x${u.row.quantity} [${u.row.source}]`);
    for (const c of u.changes) console.log(`      ${c}`);
  }
  console.log(`\nInsert ${inserts.length} missing fill(s):`);
  for (const f of inserts)
    console.log(`  ${f.tradeDate} ${f.side} ${f.ticker} ${f.quantity} @ ${f.rate}`);
  console.log(`\nLedger rows no confirmation explains (left untouched): ${unexplained.length}`);
  for (const r of unexplained)
    console.log(`  ${r.trade_date} ${r.type} ${r.ticker} x${r.quantity} @ ${r.price} [${r.source}]`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these changes.");
    return;
  }

  for (const u of updates) {
    const charges = (u.fill.commission ?? 0) + (u.fill.tax ?? 0) + (u.fill.cdc ?? 0);
    const net =
      u.fill.net ?? (u.fill.side === "BUY" ? u.fill.gross + charges : u.fill.gross - charges);
    const { error } = await s
      .from("transactions")
      .update({
        trade_date: u.fill.tradeDate,
        quantity: u.fill.quantity,
        price: u.fill.rate,
        gross_amount: u.fill.gross,
        commission: u.fill.commission,
        tax: u.fill.tax,
        net_amount: Math.round(net * 100) / 100,
        source: "email_confirmation",
      })
      .eq("id", u.row.id)
      .eq("user_id", userId);
    if (error) throw error;
  }

  for (const f of inserts) {
    const charges = (f.commission ?? 0) + (f.tax ?? 0) + (f.cdc ?? 0);
    const net = f.net ?? (f.side === "BUY" ? f.gross + charges : f.gross - charges);
    const { error } = await s.from("transactions").insert({
      user_id: userId,
      ticker: f.ticker,
      trade_date: f.tradeDate,
      type: f.side,
      quantity: f.quantity,
      price: f.rate,
      gross_amount: f.gross,
      commission: f.commission,
      tax: f.tax,
      net_amount: Math.round(net * 100) / 100,
      row_hash: `reconcile-${userId.slice(0, 8)}-${f.tradeDate}-${f.side}-${f.ticker}-${f.quantity}-${f.rate}`,
      source: "email_confirmation",
    });
    if (error) throw error;
  }

  const { recomputeHoldingsFromTransactions } = await import("../../lib/portfolio/positions");
  await recomputeHoldingsFromTransactions(s, userId);
  console.log(`\nApplied: ${updates.length} rewritten, ${inserts.length} inserted. Holdings recomputed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
