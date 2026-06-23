import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { rebuildHoldings, recomputeHoldingsFromTransactions } from "@/lib/portfolio";
import type { TxnType } from "@/lib/types";

export const maxDuration = 60;

const ipoBuySchema = z.object({
  action: z.literal("ipoBuy"),
  ticker: z.string().min(2).max(10).toUpperCase(),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.number().positive(),
  price: z.number().positive(),
  notes: z.string().max(300).optional(),
});

const mergerSchema = z.object({
  action: z.literal("merger"),
  fromTicker: z.string().min(2).max(10).toUpperCase(),
  fromQty: z.number().positive(),
  toTicker: z.string().min(2).max(10).toUpperCase(),
  toQty: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(300).optional(),
});

const bodySchema = z.discriminatedUnion("action", [ipoBuySchema, mergerSchema]);

/**
 * POST /api/corporate-actions
 *
 * Handles two corrective transaction types that don't come through normal
 * import (shares obtained via IPO/CDC outside this AKD account, or mergers
 * where the ledger shows no offsetting cash flow):
 *
 *   action: "ipoBuy"   — records a BUY at the given IPO allotment price
 *   action: "merger"   — records SELL of fromTicker (at cost, P/L = 0) and
 *                        BUY of toTicker at the same total cost basis, so the
 *                        WAC of the surviving company inherits the merged cost
 *
 * All inserts are idempotent via a deterministic row_hash.
 */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    const body = parsed.data;

    // ── IPO / CDC allotment BUY ──────────────────────────────────────────────
    if (body.action === "ipoBuy") {
      const { ticker, trade_date, quantity, price, notes } = body;
      const rowHash = `corp-action-${ticker}-${trade_date}-BUY-${quantity}`;

      const { data: dup } = await supabase
        .from("transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq("row_hash", rowHash)
        .maybeSingle();
      if (dup) {
        return NextResponse.json({ message: "Already recorded.", alreadyApplied: true });
      }

      const { error: insErr } = await supabase.from("transactions").insert({
        user_id: user.id,
        ticker,
        trade_date,
        type: "BUY" as TxnType,
        quantity,
        price,
        commission: 0,
        tax: 0,
        net_amount: Math.round(quantity * price * 100) / 100,
        notes: notes ?? `IPO/CDC allotment`,
        row_hash: rowHash,
        source: "manual",
      });
      if (insErr) throw insErr;

      await recomputeHoldingsFromTransactions(supabase, user.id);
      return NextResponse.json({
        message: `${ticker} — ${quantity.toLocaleString()} shares @ PKR ${price} added. Holdings recalculated.`,
      });
    }

    // ── Scheme-of-arrangement merger ────────────────────────────────────────
    if (body.action === "merger") {
      const { fromTicker, fromQty, toTicker, toQty, date, notes } = body;
      const sellHash = `corp-action-${fromTicker}-${date}-SELL-${fromQty}`;
      const buyHash = `corp-action-${toTicker}-${date}-BUY-merger-from-${fromTicker}`;

      const { data: dup } = await supabase
        .from("transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq("row_hash", sellHash)
        .maybeSingle();
      if (dup) {
        return NextResponse.json({ message: "Merger already recorded.", alreadyApplied: true });
      }

      // Rebuild fromTicker position to get cost basis at point of merger.
      const { data: txns } = await supabase
        .from("transactions")
        .select("id, ticker, trade_date, type, quantity, price, gross_amount, commission, tax, net_amount")
        .eq("user_id", user.id)
        .eq("ticker", fromTicker)
        .order("trade_date", { ascending: true });

      const fromTxns = (txns ?? []).map((t) => ({
        ...t,
        type: t.type as TxnType,
        quantity: t.quantity !== null ? Number(t.quantity) : null,
        price: t.price !== null ? Number(t.price) : null,
        gross_amount: t.gross_amount !== null ? Number(t.gross_amount) : null,
        commission: t.commission !== null ? Number(t.commission) : null,
        tax: t.tax !== null ? Number(t.tax) : null,
        net_amount: t.net_amount !== null ? Number(t.net_amount) : null,
      }));

      const { positions } = rebuildHoldings(fromTxns);
      const fromPos = positions.get(fromTicker);

      if (!fromPos || fromPos.totalCost <= 0) {
        return NextResponse.json(
          { error: `No cost basis found for ${fromTicker}. Ensure buy trades are imported first.` },
          { status: 422 }
        );
      }

      const totalCost = Math.round(fromPos.totalCost * 100) / 100;
      const fromAvgCost = Math.round(fromPos.avgCost * 100) / 100;
      const toPrice = Math.round((totalCost / toQty) * 100) / 100;

      // SELL fromTicker at avg cost — realized P/L is zero (cost out = proceeds).
      const { error: sellErr } = await supabase.from("transactions").insert({
        user_id: user.id,
        ticker: fromTicker,
        trade_date: date,
        type: "SELL" as TxnType,
        quantity: fromQty,
        price: fromAvgCost,
        commission: 0,
        tax: 0,
        net_amount: totalCost,
        notes: notes ?? `Merger: ${fromTicker} absorbed into ${toTicker} (scheme of arrangement)`,
        row_hash: sellHash,
        source: "manual",
      });
      if (sellErr) throw sellErr;

      // BUY toTicker — cost basis carries over from the merged entity.
      const { error: buyErr } = await supabase.from("transactions").insert({
        user_id: user.id,
        ticker: toTicker,
        trade_date: date,
        type: "BUY" as TxnType,
        quantity: toQty,
        price: toPrice,
        commission: 0,
        tax: 0,
        net_amount: totalCost,
        notes: notes ?? `Merger: ${fromQty} ${fromTicker} converted to ${toQty} ${toTicker}`,
        row_hash: buyHash,
        source: "manual",
      });
      if (buyErr) throw buyErr;

      await recomputeHoldingsFromTransactions(supabase, user.id);
      return NextResponse.json({
        message: `${fromTicker}→${toTicker} merger recorded. SELL ${fromQty} ${fromTicker} @ PKR ${fromAvgCost}, BUY ${toQty} ${toTicker} @ PKR ${toPrice} (cost basis transferred). Holdings recalculated.`,
        fromAvgCost,
        toAvgCost: toPrice,
      });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
