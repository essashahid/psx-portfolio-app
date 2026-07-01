import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/api-helpers";

const FeedbackSchema = z.object({
  visitor_id: z.string().trim().min(8).max(120),
  session_id: z.string().trim().max(120).optional().or(z.literal("")),
  kind: z.enum(["bug", "confusing", "idea", "missing", "general"]).default("general"),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  message: z.string().trim().min(5).max(2000),
  contact: z.string().trim().max(160).optional().or(z.literal("")),
  page_path: z.string().trim().min(1).max(300).default("/"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const parsed = FeedbackSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join("; ") },
        { status: 422 }
      );
    }

    const body = parsed.data;
    const { error: dbError } = await supabase.from("product_feedback").insert({
      user_id: user.id,
      visitor_id: body.visitor_id,
      session_id: body.session_id || null,
      kind: body.kind,
      rating: body.rating ?? null,
      message: body.message,
      contact: body.contact || null,
      page_path: body.page_path,
      user_agent: request.headers.get("user-agent"),
      metadata: body.metadata ?? {},
      status: "new",
    });
    if (dbError) throw dbError;

    return NextResponse.json({ ok: true, message: "Feedback sent. Thank you." });
  } catch (err) {
    return errorResponse(err);
  }
}
