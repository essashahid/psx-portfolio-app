import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/api-helpers";

export const maxDuration = 60;

export type AdminUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  onboarded: boolean;
  demo_mode: boolean;
  banned: boolean;
  created_at: string;
  last_sign_in_at: string | null;
};

// GET /api/admin/users?search=  — list every account (auth + profile merged).
export async function GET(request: Request) {
  const { admin, error } = await requireAdmin();
  if (error) return error;

  try {
    const search = new URL(request.url).searchParams.get("search")?.trim().toLowerCase() ?? "";

    // Page through the Auth admin API (max 1000/page) to collect all users.
    const authUsers: Array<{
      id: string;
      email?: string;
      created_at: string;
      last_sign_in_at?: string | null;
      banned_until?: string | null;
    }> = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listErr) throw listErr;
      authUsers.push(...(data.users as typeof authUsers));
      if (data.users.length < 200) break;
    }

    const { data: profiles, error: profErr } = await admin
      .from("profiles")
      .select("id, full_name, is_admin, onboarded, demo_mode");
    if (profErr) throw profErr;
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    const now = Date.now();
    const rows: AdminUserRow[] = authUsers.map((u) => {
      const p = byId.get(u.id);
      const banned = Boolean(u.banned_until && new Date(u.banned_until).getTime() > now);
      return {
        id: u.id,
        email: u.email ?? "",
        full_name: p?.full_name ?? null,
        is_admin: Boolean(p?.is_admin),
        onboarded: Boolean(p?.onboarded),
        demo_mode: Boolean(p?.demo_mode),
        banned,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      };
    });

    const filtered = search
      ? rows.filter(
          (r) =>
            r.email.toLowerCase().includes(search) ||
            (r.full_name ?? "").toLowerCase().includes(search)
        )
      : rows;
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return NextResponse.json({ users: filtered, total: rows.length });
  } catch (err) {
    return errorResponse(err);
  }
}

const CreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  full_name: z.string().max(120).optional(),
  is_admin: z.boolean().optional(),
});

// POST /api/admin/users  — create an account on a user's behalf (no email
// confirmation needed; they can sign in immediately with the temp password).
export async function POST(request: Request) {
  const { admin, error } = await requireAdmin();
  if (error) return error;

  try {
    const parsed = CreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    const { email, password, full_name, is_admin } = parsed.data;

    const { data, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? "" },
    });
    if (createErr) throw createErr;

    // handle_new_user() created the profile row; set any admin flag explicitly.
    if (data.user) {
      await admin
        .from("profiles")
        .update({ full_name: full_name ?? "", is_admin: Boolean(is_admin) })
        .eq("id", data.user.id);
    }

    return NextResponse.json({ ok: true, id: data.user?.id });
  } catch (err) {
    return errorResponse(err);
  }
}
