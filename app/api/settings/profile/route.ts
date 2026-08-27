import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { rejectDemoWrite } from "@/lib/demo/mode";

/**
 * The profile fields the settings screen owns.
 *
 * The web forms write these through the Supabase client directly, which RLS
 * makes safe but leaves the validation in the component. A route gives the
 * phone one place where the allowed values are decided, and nothing here can
 * be reached for another user's row.
 */
const PatchSchema = z.object({
  full_name: z.string().max(120).nullable().optional(),
  experience_level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  risk_profile: z.enum(["conservative", "balanced", "aggressive"]).nullable().optional(),
  objective: z.enum(["growth", "income", "preservation", "learning"]).nullable().optional(),
  free_cash: z.number().nonnegative().nullable().optional(),
});

export async function PATCH(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    // free_cash is NOT NULL in the schema, and clearing the field means "no
    // cash the ledger does not already account for", which is zero rather than
    // unknown. Sending null would fail the constraint.
    const patch = { ...parsed.data };
    if ("free_cash" in patch && patch.free_cash === null) patch.free_cash = 0;

    const { error: updateErr } = await supabase.from("profiles").update(patch).eq("id", user.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true, message: "Settings saved." });
  } catch (err) {
    return errorResponse(err);
  }
}
