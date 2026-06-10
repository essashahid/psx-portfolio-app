import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { chatMarkdown, aiConfigured } from "@/lib/ai/openai";

export const maxDuration = 120;

/** AI pattern analysis over the user's investment journal. */
export async function POST() {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured. Add it in .env.local to enable AI analysis." },
      { status: 503 }
    );
  }

  try {
    const [{ data: entries }, { data: holdings }] = await Promise.all([
      supabase
        .from("journal_entries")
        .select("ticker, entry_date, entry_type, title, body, expected_outcome, risk, confidence, outcome, lessons")
        .eq("user_id", user.id)
        .order("entry_date", { ascending: true })
        .limit(100),
      supabase
        .from("holdings")
        .select("ticker, sector, quantity, avg_cost")
        .eq("user_id", user.id),
    ]);

    if (!entries || entries.length < 2) {
      return NextResponse.json(
        { error: "Not enough journal entries to analyze. Write at least 2 entries first." },
        { status: 422 }
      );
    }

    const context = [
      "## Journal entries (oldest first)",
      ...entries.map(
        (e) =>
          `- ${e.entry_date} [${e.entry_type}] ${e.ticker ?? "general"} "${e.title}" (confidence ${e.confidence ?? "?"}/5)\n  Body: ${(e.body ?? "").slice(0, 300)}\n  Expected: ${(e.expected_outcome ?? "-").slice(0, 150)} | Risk: ${(e.risk ?? "-").slice(0, 150)} | Outcome: ${(e.outcome ?? "not recorded").slice(0, 150)} | Lessons: ${(e.lessons ?? "-").slice(0, 150)}`
      ),
      "",
      "## Current holdings",
      ...(holdings ?? []).map((h) => `- ${h.ticker} (${h.sector ?? "?"}): ${h.quantity} @ ${h.avg_cost}`),
    ].join("\n");

    const output = await logAgentRun(supabase, user.id, "journal_analysis", { entries: entries.length }, async () => {
      const { content, model } = await chatMarkdown(
        "You analyze an investor's journal for behavioral patterns. Be honest but constructive. Base every observation on specific entries; quote entry titles/dates as evidence. If the journal is too thin to support a pattern, say so rather than inventing one.",
        `Analyze this investment journal for patterns. Cover, where the data allows:
1. Repeated mistakes or repeated good habits.
2. Sectors where decisions seem better/worse documented or reasoned.
3. Whether decisions look thesis-driven or news/reaction-driven.
4. Whether high-confidence entries (4-5/5) were followed up and how they resolved.
5. Common risk patterns the user keeps accepting.
6. Signs of over-concentration in attention or capital.
7. Three specific suggestions for better journaling — not better investing.

--- JOURNAL ---
${context}`,
        1800
      );
      const { data: saved, error: insErr } = await supabase
        .from("ai_briefings")
        .insert({
          user_id: user.id,
          briefing_type: "journal_analysis",
          title: "Journal Pattern Analysis",
          content,
          model,
        })
        .select("id, title, content, created_at")
        .single();
      if (insErr) throw insErr;
      return { result: saved };
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
