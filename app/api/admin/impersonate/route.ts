import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/api-helpers";

const COOKIE = "x_admin_impersonate";

const StartSchema = z.object({ userId: z.string().uuid() });

// POST /api/admin/impersonate { userId } — start viewing as that user.
export async function POST(request: Request) {
  const { admin, error } = await requireAdmin();
  if (error) return error;

  try {
    const parsed = StartSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 422 });
    }
    // Confirm the target user actually exists before setting the cookie.
    const { data, error: userErr } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (userErr || !data?.user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, parsed.data.userId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8, // 8 hours — clears automatically at end of session
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/admin/impersonate — stop impersonating and return to admin self.
export async function DELETE() {
  const { error } = await requireAdmin();
  if (error) return error;

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
