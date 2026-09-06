import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/shared/api";

const Schema = z.object({
  /** A waitlist row to invite, or a bare email for someone not on the list. */
  id: z.string().uuid().optional(),
  email: z.string().trim().email().optional(),
  fullName: z.string().trim().max(120).optional(),
});

/**
 * POST /api/admin/waitlist/invite
 *
 * Creates the account through Supabase's invite flow, which emails a link to
 * /auth/callback; the user then sets a password and lands in onboarding. The
 * waitlist row is marked invited and tied to the new user id, so "did they
 * come in" is answerable later.
 *
 * Manual prerequisite, once: the Supabase project's Auth settings must list
 * `{site}/auth/callback` as an allowed redirect URL and the Site URL must be
 * the production origin, or the link in the email points at localhost.
 */
export async function POST(request: Request) {
  const { admin, error } = await requireAdmin();
  if (error) return error;
  try {
    const parsed = Schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Pass a waitlist id or an email." }, { status: 422 });

    let email = parsed.data.email?.toLowerCase() ?? null;
    let fullName = parsed.data.fullName ?? null;
    let rowId = parsed.data.id ?? null;
    if (rowId) {
      const { data: row } = await admin.from("waitlist_entries").select("id, email, full_name, status").eq("id", rowId).maybeSingle();
      if (!row) return NextResponse.json({ error: "Waitlist entry not found." }, { status: 404 });
      if (!row.email) return NextResponse.json({ error: "This entry has no email address; invite by email instead." }, { status: 422 });
      email = String(row.email).toLowerCase();
      fullName = fullName ?? (row.full_name as string | null);
    }
    if (!email) return NextResponse.json({ error: "An email address is required." }, { status: 422 });

    const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
    const { data, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/auth/set-password`,
      data: fullName ? { full_name: fullName } : undefined,
    });
    if (inviteError) {
      // An account that already exists cannot be invited twice; say so plainly.
      const msg = /already/i.test(inviteError.message) ? "This email already has an account." : inviteError.message;
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    const userId = data.user?.id ?? null;
    if (!rowId && userId) {
      // Not on the list: record the invite so the beta cohort is one table.
      const { data: inserted } = await admin
        .from("waitlist_entries")
        .insert({ full_name: fullName ?? email, email, source: "admin-invite", status: "invited", invited_at: new Date().toISOString(), converted_user_id: userId })
        .select("id")
        .maybeSingle();
      rowId = inserted?.id ? String(inserted.id) : null;
    } else if (rowId) {
      await admin
        .from("waitlist_entries")
        .update({ status: "invited", invited_at: new Date().toISOString(), converted_user_id: userId, updated_at: new Date().toISOString() })
        .eq("id", rowId);
    }
    return NextResponse.json({ ok: true, userId, email });
  } catch (err) {
    return errorResponse(err);
  }
}
