import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-helpers";
import { accountHasFeature } from "@/lib/features";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  if (!(await accountHasFeature(supabase, user.id, "/chat"))) {
    return NextResponse.json({ error: "Research Copilot is disabled for this account." }, { status: 403 });
  }
  const { id } = await params;

  const { data: thread, error: threadError } = await supabase
    .from("chat_threads")
    .select("id, title, summary, created_at, updated_at, last_message_at")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();

  if (threadError) return NextResponse.json({ error: threadError.message }, { status: 500 });
  if (!thread) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  const { data: messages, error: messagesError } = await supabase
    .from("chat_messages")
    .select("id, role, content, thinking, cards, created_at")
    .eq("user_id", user.id)
    .eq("thread_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) return NextResponse.json({ error: messagesError.message }, { status: 500 });
  return NextResponse.json({ thread, messages: messages ?? [] });
}

export async function PATCH(request: Request, { params }: Params) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  if (!(await accountHasFeature(supabase, user.id, "/chat"))) {
    return NextResponse.json({ error: "Research Copilot is disabled for this account." }, { status: 403 });
  }
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { title?: string };
  const title = cleanTitle(body.title);
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const { data, error: dbError } = await supabase
    .from("chat_threads")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("id", id)
    .select("id, title, summary, created_at, updated_at, last_message_at")
    .maybeSingle();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ thread: data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  if (!(await accountHasFeature(supabase, user.id, "/chat"))) {
    return NextResponse.json({ error: "Research Copilot is disabled for this account." }, { status: 403 });
  }
  const { id } = await params;

  const { error: dbError } = await supabase
    .from("chat_threads")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function cleanTitle(value: string | undefined): string | null {
  const title = value?.replace(/\s+/g, " ").trim();
  if (!title) return null;
  return title.slice(0, 80);
}
