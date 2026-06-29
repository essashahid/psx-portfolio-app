import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { recomputeAll } from "@/lib/holdings/recompute-cascade";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 60;

const txnSchema = z.object({
  ticker: z.string().min(2).max(10),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["BUY", "SELL", "DIVIDEND", "BONUS", "RIGHT", "SPLIT", "ADJUST"]),
  quantity: z.number().positive().optional(),
  price: z.number().nonnegative().optional(),
  commission: z.number().nonnegative().optional(),
  tax: z.number().nonnegative().optional(),
  net_amount: z.number().optional(),
  notes: z.string().max(500).optional(),
});

/** Manual transaction or dividend entry; holdings are recomputed afterwards. */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const parsed = txnSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    const t = parsed.data;
    const ticker = t.ticker.toUpperCase();

    if (t.type === "DIVIDEND") {
      const amount = t.net_amount ?? (t.quantity ?? 0) * (t.price ?? 0);
      if (!amount) {
        return NextResponse.json({ error: "Dividend needs a net amount (or quantity × per-share amount)." }, { status: 422 });
      }
      const { error: insErr } = await supabase.from("dividends").insert({
        user_id: user.id,
        ticker,
        pay_date: t.trade_date,
        payment_date: t.trade_date,
        dividend_per_share: t.price ?? null,
        quantity_held: t.quantity ?? null,
        amount,
        tax: t.tax ?? null,
        net_amount: t.net_amount ?? amount,
        status: "received",
        source: "manual",
        notes: t.notes ?? null,
        row_hash: `manual-${user.id}-${ticker}-${t.trade_date}-${amount}-${Date.now()}`,
      });
      if (insErr) throw insErr;
      return NextResponse.json({ ok: true, message: "Dividend recorded." });
    }

    if ((t.type === "BUY" || t.type === "SELL") && (!t.quantity || t.price === undefined)) {
      return NextResponse.json({ error: "Buy/sell needs quantity and price." }, { status: 422 });
    }
    if ((t.type === "BONUS" || t.type === "RIGHT" || t.type === "SPLIT" || t.type === "ADJUST") && !t.quantity) {
      return NextResponse.json({ error: `${t.type} needs a quantity.` }, { status: 422 });
    }

    const { error: insErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      ticker,
      trade_date: t.trade_date,
      type: t.type,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
      commission: t.commission ?? null,
      tax: t.tax ?? null,
      net_amount: t.net_amount ?? null,
      source: "manual",
      notes: t.notes ?? null,
      row_hash: `manual-${user.id}-${ticker}-${t.trade_date}-${t.type}-${t.quantity}-${t.price}-${Date.now()}`,
    });
    if (insErr) throw insErr;

    await recomputeAll(supabase, user.id, { changedTickers: [ticker] });

    return NextResponse.json({
      ok: true,
      message: "Transaction recorded and portfolio recomputed.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
