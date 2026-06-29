import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { recomputeAll } from "@/lib/holdings/recompute-cascade";
import { rejectDemoWrite } from "@/lib/demo-mode";

const PatchSchema = z.object({
  quantity: z.number().positive().optional(),
  avg_cost: z.number().nonnegative().optional(),
  notes: z.string().max(1000).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  const { ticker } = await params;
  const symbol = ticker.toUpperCase();
  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid fields" }, { status: 400 });

  const { data: existing, error: readErr } = await supabase
    .from("holdings")
    .select("quantity, avg_cost")
    .eq("user_id", user.id)
    .eq("ticker", symbol)
    .maybeSingle();
  if (readErr) return errorResponse(readErr);

  const currentQty = Number(existing?.quantity ?? 0);
  const currentAvg = Number(existing?.avg_cost ?? 0);
  const targetQty = parsed.data.quantity ?? currentQty;
  const targetAvg = parsed.data.avg_cost ?? currentAvg;
  const qtyDelta = targetQty - currentQty;
  const avgChanged = parsed.data.avg_cost !== undefined && Math.abs(targetAvg - currentAvg) >= 0.0001;

  if (Math.abs(qtyDelta) < 0.0001 && !avgChanged && parsed.data.notes === undefined) {
    return NextResponse.json({ message: `${symbol} unchanged.` });
  }

  const notes = parsed.data.notes?.trim() || `Holding edit for ${symbol}`;
  if (Math.abs(qtyDelta) >= 0.0001) {
    const price = qtyDelta > 0 ? targetAvg : currentAvg;
    const netAmount = qtyDelta > 0 ? Math.abs(qtyDelta) * price : null;
    const { error: insErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      ticker: symbol,
      trade_date: new Date().toISOString().slice(0, 10),
      type: "ADJUST",
      quantity: qtyDelta,
      price,
      gross_amount: netAmount,
      commission: 0,
      tax: 0,
      net_amount: netAmount,
      source: "manual",
      notes,
      row_hash: `holding-adjust-${user.id}-${symbol}-${Date.now()}`,
    });
    if (insErr) return errorResponse(insErr);
  } else if (avgChanged) {
    // A pure average-cost edit is represented as a zero-quantity cost reset.
    // Holdings recompute ignores it for quantity but keeps the audit trail.
    const { error: insErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      ticker: symbol,
      trade_date: new Date().toISOString().slice(0, 10),
      type: "ADJUST",
      quantity: 0,
      price: targetAvg,
      gross_amount: null,
      commission: 0,
      tax: 0,
      net_amount: null,
      source: "manual",
      notes: `${notes}; avg cost requested ${targetAvg}`,
      row_hash: `holding-cost-note-${user.id}-${symbol}-${Date.now()}`,
    });
    if (insErr) return errorResponse(insErr);
  }

  await recomputeAll(supabase, user.id, { changedTickers: [symbol] });
  return NextResponse.json({ message: `${symbol} adjusted through the ledger.` });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  const { ticker } = await params;
  const symbol = ticker.toUpperCase();

  // Remove all user data for this ticker in parallel
  await Promise.all([
    supabase.from("holdings").delete().eq("user_id", user.id).eq("ticker", symbol),
    supabase.from("transactions").delete().eq("user_id", user.id).eq("ticker", symbol),
    supabase.from("targets").delete().eq("user_id", user.id).eq("ticker", symbol),
    supabase.from("theses").delete().eq("user_id", user.id).eq("ticker", symbol),
    supabase.from("alerts").delete().eq("user_id", user.id).eq("ticker", symbol),
    supabase.from("dividends").delete().eq("user_id", user.id).eq("ticker", symbol),
    supabase.from("news_articles").delete().eq("user_id", user.id).eq("ticker", symbol),
    supabase.from("journal_entries").delete().eq("user_id", user.id).eq("ticker", symbol),
  ]);

  await recomputeAll(supabase, user.id, { changedTickers: [symbol] });
  return NextResponse.json({ message: `${symbol} and all related data removed.` });
}
