import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { generateBriefing } from "@/lib/ai/briefings";
import { aiAvailable } from "@/lib/ai/openai";
import { rejectDemoWrite } from "@/lib/demo-mode";
import type { BriefingType } from "@/lib/types";

export const maxDuration = 120;

const ALLOWED: BriefingType[] = [
  "daily",
  "weekly",
  "risk_review",
  "news_only",
  "dividend_review",
  "thesis_review",
];

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  if (!aiAvailable()) {
    return NextResponse.json(
      { error: "AI provider is not configured. Add TASKS_API_KEY or DEEPSEEK_API_KEY in .env.local." },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { type?: BriefingType };
    const type = body.type && ALLOWED.includes(body.type) ? body.type : "daily";

    const { count } = await supabase
      .from("holdings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (!count) {
      return NextResponse.json(
        { error: "No holdings yet. Import a statement or load demo data first." },
        { status: 422 }
      );
    }

    const output = await logAgentRun(supabase, user.id, "briefing", { type }, async () => {
      const { title, content, model } = await generateBriefing(supabase, user.id, type);
      const { data: saved, error: insErr } = await supabase
        .from("ai_briefings")
        .insert({ user_id: user.id, briefing_type: type, title, content, model })
        .select("id, briefing_type, title, content, model, created_at")
        .single();
      if (insErr) throw insErr;
      return { briefing: saved };
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
