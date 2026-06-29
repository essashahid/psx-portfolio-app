import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/api-helpers";
import { ALL_ACCOUNT_FEATURES, CHAT_PROVIDERS } from "@/lib/features";

export const maxDuration = 60;

// GET /api/admin/users/:id — full account detail + portfolio summary.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  try {
    const [{ data: authRes, error: authErr }, { data: profile, error: profErr }] = await Promise.all([
      admin.auth.admin.getUserById(id),
      admin.from("profiles").select("*").eq("id", id).maybeSingle(),
    ]);
    if (authErr) throw authErr;
    if (profErr) throw profErr;
    if (!authRes?.user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Counts give a quick read of the account without dumping every row.
    const countOf = async (table: string) => {
      const { count } = await admin
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", id);
      return count ?? 0;
    };
    const [holdings, transactions, dividends, cash] = await Promise.all([
      countOf("holdings"),
      countOf("transactions"),
      countOf("dividends"),
      countOf("cash_movements"),
    ]);

    const { data: holdingRows } = await admin
      .from("holdings")
      .select("ticker, company_name, quantity, avg_cost, total_cost")
      .eq("user_id", id)
      .order("total_cost", { ascending: false })
      .limit(100);

    const u = authRes.user;
    const banned = Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now());

    return NextResponse.json({
      auth: {
        id: u.id,
        email: u.email ?? "",
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        banned,
      },
      profile,
      summary: { holdings, transactions, dividends, cash },
      holdings: holdingRows ?? [],
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const EnabledFeaturesSchema = z.array(z.enum(ALL_ACCOUNT_FEATURES)).superRefine((features, ctx) => {
  if (!features.includes("/dashboard")) {
    ctx.addIssue({
      code: "custom",
      message: "Dashboard must stay enabled.",
    });
  }
});

const UpdateSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().max(120).nullable().optional(),
  is_admin: z.boolean().optional(),
  onboarded: z.boolean().optional(),
  demo_mode: z.boolean().optional(),
  base_currency: z.string().min(2).max(8).optional(),
  experience_level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  enabled_features: EnabledFeaturesSchema.optional(),
  allowed_llm_providers: z.array(z.enum(CHAT_PROVIDERS)).optional(),
});

// PATCH /api/admin/users/:id — edit account email and/or profile fields.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, user, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  try {
    const parsed = UpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    const { email, ...profileFields } = parsed.data;

    // Guard: an admin cannot strip their own admin rights (avoids locking the
    // last admin out of the panel by accident).
    if (id === user.id && profileFields.is_admin === false) {
      return NextResponse.json(
        { error: "You cannot remove your own admin access." },
        { status: 400 }
      );
    }

    if (email) {
      const { error: emailErr } = await admin.auth.admin.updateUserById(id, { email });
      if (emailErr) throw emailErr;
    }
    if (Object.keys(profileFields).length > 0) {
      const { error: updErr } = await admin.from("profiles").update(profileFields).eq("id", id);
      if (updErr) throw updErr;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/admin/users/:id — permanently delete the account. All user-owned
// rows cascade via the auth.users FK (on delete cascade).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, user, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  try {
    if (id === user.id) {
      return NextResponse.json({ error: "You cannot delete your own account here." }, { status: 400 });
    }
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) throw delErr;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
