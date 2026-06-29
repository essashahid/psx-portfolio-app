import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { rejectDemoWrite } from "@/lib/demo-mode";

const schema = z.object({
  taxpayer_status: z.enum(["filer", "non-filer"]),
  tax_year: z.string().min(4).max(10),
  dividend_tax_rate: z.number().min(0).max(1),
  default_payment_window_days: z.number().int().min(1).max(120),
  default_face_value: z.number().positive().max(1000),
  source_note: z.string().max(500).optional().nullable(),
  show_forecasts_in_review: z.boolean(),
  auto_create_confirmed: z.boolean(),
});

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    const { error: upErr } = await supabase.from("tax_settings").upsert(
      {
        user_id: user.id,
        country: "PK",
        ...parsed.data,
        source_note: parsed.data.source_note || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (upErr) throw upErr;
    return NextResponse.json({ ok: true, message: "Tax profile saved. New dividend calculations will use it." });
  } catch (err) {
    return errorResponse(err);
  }
}
