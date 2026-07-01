import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/guard";
import { errorResponse } from "@/lib/api-helpers";

export type AdminFeedbackRow = {
  id: string;
  user_id: string | null;
  visitor_id: string;
  session_id: string | null;
  kind: "bug" | "confusing" | "idea" | "missing" | "general";
  rating: number | null;
  message: string;
  contact: string | null;
  page_path: string;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  status: "new" | "reviewed" | "closed";
  admin_notes: string | null;
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
      .from("product_feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (status && status !== "all") query = query.eq("status", status);

    const { data, error: dbError } = await query;
    if (dbError) throw dbError;

    const feedback = ((data ?? []) as AdminFeedbackRow[]).filter((entry) => {
      if (!search) return true;
      return [entry.message, entry.contact, entry.page_path, entry.kind, entry.visitor_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });

    return NextResponse.json({ feedback });
  } catch (err) {
    return errorResponse(err);
  }
}

const PatchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "reviewed", "closed"]).optional(),
  admin_notes: z.string().max(1000).nullable().optional(),
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

    const { id, status, admin_notes } = parsed.data;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) update.status = status;
    if (admin_notes !== undefined) update.admin_notes = admin_notes;

    const { data, error: dbError } = await admin
      .from("product_feedback")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (dbError) throw dbError;

    return NextResponse.json({ feedback: data });
  } catch (err) {
    return errorResponse(err);
  }
}
