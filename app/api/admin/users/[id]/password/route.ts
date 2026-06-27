import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/api-helpers";

export const maxDuration = 60;

const Schema = z.object({ password: z.string().min(8).max(72) });

// POST /api/admin/users/:id/password — set a new password for the account.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, error } = await requireAdmin();
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
    const { error: updErr } = await admin.auth.admin.updateUserById(id, {
      password: parsed.data.password,
    });
    if (updErr) throw updErr;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
