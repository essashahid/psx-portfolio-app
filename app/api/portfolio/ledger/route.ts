import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { buildLedgerRows } from "@/lib/engine/ledger-view";
import type { LedgerResponse } from "@psx/shared/api/ledger";

export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const [txnsRes, cashRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, trade_date, type, ticker, quantity, price, commission, tax, net_amount, notes")
        .eq("user_id", user.id)
        .order("trade_date", { ascending: true }),
      supabase
        .from("cash_movements")
        .select("id, movement_date, type, amount, description")
        .eq("user_id", user.id)
        .order("movement_date", { ascending: true }),
    ]);
    if (txnsRes.error) throw txnsRes.error;
    if (cashRes.error) throw cashRes.error;

    const transactions = txnsRes.data ?? [];
    const cashMovements = cashRes.data ?? [];
    // The running balance only makes sense oldest-first, so it is built that
    // way and reversed afterwards rather than computed backwards.
    const { rows, closingBalance } = buildLedgerRows(transactions, cashMovements);

    const body: LedgerResponse = {
      entries: rows
        .slice()
        .reverse()
        .map(({ editable: _editable, ...entry }) => entry),
      transactions,
      cashMovements,
      closingBalance,
      count: rows.length,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
