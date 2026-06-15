import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-helpers";

export async function GET() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const { data, error: dbError } = await supabase
    .from("chat_threads")
    .select("id, title, summary, created_at, updated_at, last_message_at")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })
    .limit(50);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ threads: data ?? [] });
}

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as { title?: string };
  const title = cleanTitle(body.title) || "New chat";

  const { data, error: dbError } = await supabase
    .from("chat_threads")
    .insert({ user_id: user.id, title })
    .select("id, title, summary, created_at, updated_at, last_message_at")
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ thread: data });
}

function cleanTitle(value: string | undefined): string | null {
  const title = value?.replace(/\s+/g, " ").trim();
  if (!title) return null;
  return title.slice(0, 80);
}
