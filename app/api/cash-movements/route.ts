import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { recomputeAll } from "@/lib/holdings/recompute-cascade";

export const maxDuration = 60;

const CashSchema = z.object({
  movement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["CASH_IN", "CASH_OUT", "FEE", "TAX", "DIVIDEND"]),
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const parsed = CashSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    const c = parsed.data;
    const { error: insErr } = await supabase.from("cash_movements").insert({
      user_id: user.id,
      movement_date: c.movement_date,
      type: c.type,
      amount: c.amount,
      description: c.description ?? null,
      source: "manual",
      row_hash: `manual-cash-${user.id}-${c.movement_date}-${c.type}-${c.amount}-${Date.now()}`,
    });
    if (insErr) throw insErr;

    await recomputeAll(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Cash movement recorded." });
  } catch (err) {
    return errorResponse(err);
  }
}
