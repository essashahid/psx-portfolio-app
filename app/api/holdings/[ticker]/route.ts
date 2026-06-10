import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";

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

  const { ticker } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid fields" }, { status: 400 });

  const updates: Record<string, unknown> = { last_updated: new Date().toISOString() };
  if (parsed.data.quantity !== undefined) {
    updates.quantity = parsed.data.quantity;
  }
  if (parsed.data.avg_cost !== undefined) {
    updates.avg_cost = parsed.data.avg_cost;
    // Recalculate total_cost if both are provided or quantity already exists
    if (parsed.data.quantity !== undefined) {
      updates.total_cost = parsed.data.quantity * parsed.data.avg_cost;
    }
  }
  if (parsed.data.notes !== undefined) {
    updates.notes = parsed.data.notes;
  }

  // If we changed quantity or avg_cost, also update total_cost from current values
  if ((parsed.data.quantity !== undefined || parsed.data.avg_cost !== undefined) &&
      !(parsed.data.quantity !== undefined && parsed.data.avg_cost !== undefined)) {
    const { data: existing } = await supabase
      .from("holdings")
      .select("quantity, avg_cost")
      .eq("user_id", user.id)
      .eq("ticker", ticker)
      .maybeSingle();
    if (existing) {
      const qty = parsed.data.quantity ?? Number(existing.quantity);
      const cost = parsed.data.avg_cost ?? Number(existing.avg_cost);
      updates.total_cost = qty * cost;
    }
  }

  const { error: dbErr } = await supabase
    .from("holdings")
    .update(updates)
    .eq("user_id", user.id)
    .eq("ticker", ticker);

  if (dbErr) return errorResponse(dbErr);
  return NextResponse.json({ message: `${ticker} updated.` });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { ticker } = await params;

  // Remove all user data for this ticker in parallel
  await Promise.all([
    supabase.from("holdings").delete().eq("user_id", user.id).eq("ticker", ticker),
    supabase.from("transactions").delete().eq("user_id", user.id).eq("ticker", ticker),
    supabase.from("targets").delete().eq("user_id", user.id).eq("ticker", ticker),
    supabase.from("theses").delete().eq("user_id", user.id).eq("ticker", ticker),
    supabase.from("alerts").delete().eq("user_id", user.id).eq("ticker", ticker),
    supabase.from("dividends").delete().eq("user_id", user.id).eq("ticker", ticker),
    supabase.from("news_articles").delete().eq("user_id", user.id).eq("ticker", ticker),
    supabase.from("journal_entries").delete().eq("user_id", user.id).eq("ticker", ticker),
  ]);

  return NextResponse.json({ message: `${ticker} and all related data removed.` });
}
