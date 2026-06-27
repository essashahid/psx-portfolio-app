import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/api-helpers";

export const maxDuration = 60;

const Schema = z.object({ banned: z.boolean() });

// POST /api/admin/users/:id/ban — suspend ({banned:true}) or restore an account.
// A banned user cannot sign in; their data is left untouched.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, user, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  try {
    const parsed = Schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    if (id === user.id && parsed.data.banned) {
      return NextResponse.json({ error: "You cannot suspend your own account." }, { status: 400 });
    }
    // Supabase expects a duration string; "none" lifts an existing ban.
    const { error: updErr } = await admin.auth.admin.updateUserById(id, {
      ban_duration: parsed.data.banned ? "876000h" : "none",
    });
    if (updErr) throw updErr;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
