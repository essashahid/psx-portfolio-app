import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { rejectDemoWrite } from "@/lib/demo-mode";

type Body = {
  id?: string;
  storage?: "global" | "legacy";
  field?: "saved" | "ignored";
  value?: boolean;
};

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    if (!body.id || (body.field !== "saved" && body.field !== "ignored") || typeof body.value !== "boolean") {
      return NextResponse.json({ error: "Invalid article action." }, { status: 400 });
    }

    if (body.storage === "global") {
      const { error: upsertError } = await supabase.from("news_article_relevance").upsert(
        {
          user_id: user.id,
          article_id: body.id,
          [body.field]: body.value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,article_id" }
      );
      if (upsertError) throw upsertError;
    } else {
      const { error: updateError } = await supabase
        .from("news_articles")
        .update({ [body.field]: body.value })
        .eq("user_id", user.id)
        .eq("id", body.id);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
