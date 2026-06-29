import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { accountHasFeature } from "@/lib/features";

/** Deletes one uploaded statement file + its import batches/rows. Committed portfolio data stays. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    if (!(await accountHasFeature(supabase, user.id, "/import"))) {
      return NextResponse.json({ error: "Statement file management is disabled for this account." }, { status: 403 });
    }

    const { id } = await params;
    const { data: stmt } = await supabase
      .from("uploaded_statements")
      .select("id, storage_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (!stmt) return NextResponse.json({ error: "Statement not found" }, { status: 404 });

    if (stmt.storage_path) {
      await supabase.storage.from("statements").remove([stmt.storage_path]);
    }
    await supabase.from("uploaded_statements").delete().eq("id", id).eq("user_id", user.id);
    return NextResponse.json({ ok: true, message: "Statement deleted. Committed portfolio data was kept." });
  } catch (err) {
    return errorResponse(err);
  }
}
