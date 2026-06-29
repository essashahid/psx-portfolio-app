import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { rejectDemoWrite } from "@/lib/demo-mode";

export const maxDuration = 120;

/** Deletes all portfolio data for the current user. Statement files in storage are removed too. */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== "RESET") {
      return NextResponse.json({ error: 'Send {"confirm":"RESET"} to confirm.' }, { status: 400 });
    }

    // remove stored statement files
    const { data: statements } = await supabase
      .from("uploaded_statements")
      .select("storage_path")
      .eq("user_id", user.id)
      .not("storage_path", "is", null);
    const paths = (statements ?? []).map((s) => s.storage_path as string);
    if (paths.length) await supabase.storage.from("statements").remove(paths);

    const tables = [
      "alerts", "ai_briefings", "news_articles", "journal_entries", "theses", "targets",
      "portfolio_snapshots", "prices", "cash_movements", "dividends", "transactions",
      "holdings", "import_rows", "import_batches", "uploaded_statements", "agent_runs",
    ];
    for (const table of tables) {
      const { error: delErr } = await supabase.from(table).delete().eq("user_id", user.id);
      if (delErr) throw new Error(`Failed clearing ${table}: ${delErr.message}`);
    }
    await supabase.from("profiles").update({ demo_mode: false }).eq("id", user.id);

    return NextResponse.json({ ok: true, message: "Portfolio reset. All data and uploaded statements deleted." });
  } catch (err) {
    return errorResponse(err);
  }
}
