import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { recomputeAll } from "@/lib/holdings/recompute-cascade";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 60;

const PatchSchema = z.object({
  ticker: z.string().min(2).max(10).optional(),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["BUY", "SELL", "BONUS", "RIGHT", "SPLIT", "ADJUST"]).optional(),
  quantity: z.number().optional(),
  price: z.number().nonnegative().nullable().optional(),
  commission: z.number().nonnegative().nullable().optional(),
  tax: z.number().nonnegative().nullable().optional(),
  net_amount: z.number().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const { id } = await params;
    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }

    const before = await supabase
      .from("transactions")
      .select("ticker")
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    const updates: Record<string, unknown> = { ...parsed.data };
    if (typeof updates.ticker === "string") updates.ticker = updates.ticker.toUpperCase();
    const { data, error: updateErr } = await supabase
      .from("transactions")
      .update(updates)
      .eq("user_id", user.id)
      .eq("id", id)
      .select("ticker")
      .single();
    if (updateErr) throw updateErr;

    await recomputeAll(supabase, user.id, {
      changedTickers: [...new Set([before.data.ticker, data.ticker].filter(Boolean) as string[])],
    });
    return NextResponse.json({ ok: true, message: "Transaction updated." });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const { id } = await params;
    const before = await supabase
      .from("transactions")
      .select("ticker")
      .eq("user_id", user.id)
      .eq("id", id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

    const { error: deleteErr } = await supabase
      .from("transactions")
      .delete()
      .eq("user_id", user.id)
      .eq("id", id);
    if (deleteErr) throw deleteErr;

    await recomputeAll(supabase, user.id, { changedTickers: [before.data.ticker].filter(Boolean) as string[] });
    return NextResponse.json({ ok: true, message: "Transaction deleted." });
  } catch (err) {
    return errorResponse(err);
  }
}
