import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { recomputeHoldingsFromTransactions, takeSnapshot } from "@/lib/portfolio";
import { refreshAlerts } from "@/lib/alerts";

export const maxDuration = 60;

const txnSchema = z.object({
  ticker: z.string().min(2).max(10),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["BUY", "SELL", "DIVIDEND", "BONUS", "RIGHT"]),
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
        amount,
        tax: t.tax ?? null,
        net_amount: t.net_amount ?? amount,
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
    if ((t.type === "BONUS" || t.type === "RIGHT") && !t.quantity) {
      return NextResponse.json({ error: "Bonus/right needs a quantity." }, { status: 422 });
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

    await recomputeHoldingsFromTransactions(supabase, user.id);
    await takeSnapshot(supabase, user.id);
    await refreshAlerts(supabase, user.id);

    return NextResponse.json({ ok: true, message: "Transaction recorded and holdings recalculated." });
  } catch (err) {
    return errorResponse(err);
  }
}
