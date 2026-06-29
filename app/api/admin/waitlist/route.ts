import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/api-helpers";

export type AdminWaitlistRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  source: string;
  status: "new" | "contacted" | "invited" | "rejected" | "converted";
  admin_notes: string | null;
  contacted_at: string | null;
  invited_at: string | null;
  converted_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  const { admin, error } = await requireAdmin();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim().toLowerCase() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";

    let query = admin
      .from("waitlist_entries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (status && status !== "all") query = query.eq("status", status);

    const { data, error: dbError } = await query;
    if (dbError) throw dbError;

    const entries = ((data ?? []) as AdminWaitlistRow[]).filter((entry) => {
      if (!search) return true;
      return [entry.full_name, entry.email, entry.phone, entry.note]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });

    return NextResponse.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}

const PatchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "contacted", "invited", "rejected", "converted"]).optional(),
  admin_notes: z.string().max(1000).nullable().optional(),
  converted_user_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: Request) {
  const { admin, error } = await requireAdmin();
  if (error) return error;

  try {
    const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") },
        { status: 422 }
      );
    }

    const { id, status, admin_notes, converted_user_id } = parsed.data;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) {
      update.status = status;
      if (status === "contacted") update.contacted_at = new Date().toISOString();
      if (status === "invited") update.invited_at = new Date().toISOString();
    }
    if (admin_notes !== undefined) update.admin_notes = admin_notes;
    if (converted_user_id !== undefined) update.converted_user_id = converted_user_id;

    const { data, error: dbError } = await admin
      .from("waitlist_entries")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (dbError) throw dbError;
    return NextResponse.json({ entry: data });
  } catch (err) {
    return errorResponse(err);
  }
}
