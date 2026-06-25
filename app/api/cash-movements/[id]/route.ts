import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { recomputeAll } from "@/lib/holdings/recompute-cascade";

export const maxDuration = 60;

const PatchSchema = z.object({
  movement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  type: z.enum(["CASH_IN", "CASH_OUT", "FEE", "TAX", "DIVIDEND"]).optional(),
  amount: z.number().positive().optional(),
  description: z.string().max(500).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }

    const { data, error: updateErr } = await supabase
      .from("cash_movements")
      .update(parsed.data)
      .eq("user_id", user.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (updateErr) throw updateErr;
    if (!data) return NextResponse.json({ error: "Cash movement not found" }, { status: 404 });

    await recomputeAll(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Cash movement updated." });
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

  try {
    const { id } = await params;
    const { data, error: deleteErr } = await supabase
      .from("cash_movements")
      .delete()
      .eq("user_id", user.id)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (deleteErr) throw deleteErr;
    if (!data) return NextResponse.json({ error: "Cash movement not found" }, { status: 404 });

    await recomputeAll(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Cash movement deleted." });
  } catch (err) {
    return errorResponse(err);
  }
}
