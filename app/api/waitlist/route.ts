import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/api-helpers";

const WaitlistSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    note: z.string().trim().max(1000).optional().or(z.literal("")),
    source: z.string().trim().max(80).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.email && !value.phone) {
      ctx.addIssue({
        code: "custom",
        message: "Add an email address or phone number.",
        path: ["email"],
      });
    }
  });

export async function POST(request: Request) {
  try {
    const parsed = WaitlistSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join("; ") },
        { status: 422 }
      );
    }

    const body = parsed.data;
    const email = body.email ? body.email.toLowerCase() : null;
    const phone = body.phone || null;
    const admin = createAdminClient();

    if (email) {
      const { data: existing, error: readError } = await admin
        .from("waitlist_entries")
        .select("id, status")
        .eq("email", email)
        .maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error: updateError } = await admin
          .from("waitlist_entries")
          .update({
            full_name: body.full_name,
            phone,
            note: body.note || null,
            source: body.source ?? "login",
            updated_at: new Date().toISOString(),
            status: existing.status === "rejected" ? "new" : existing.status,
          })
          .eq("id", existing.id);
        if (updateError) throw updateError;
        return NextResponse.json({ ok: true, message: "You are on the waitlist. I will reach out before onboarding." });
      }
    }

    const { error } = await admin.from("waitlist_entries").insert({
      full_name: body.full_name,
      email,
      phone,
      note: body.note || null,
      source: body.source ?? "login",
      status: "new",
    });
    if (error) throw error;

    return NextResponse.json({ ok: true, message: "You are on the waitlist. I will reach out before onboarding." });
  } catch (err) {
    return errorResponse(err);
  }
}
