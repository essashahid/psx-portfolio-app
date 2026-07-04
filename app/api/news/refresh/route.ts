import { NextResponse } from "next/server";
import { requireUser, errorResponse, logAgentRun } from "@/lib/api-helpers";
import { refreshNewsForUser } from "@/lib/news/refresh";
import { refreshAlerts } from "@/lib/alerts";
import { rejectDemoWrite } from "@/lib/demo-mode";
import { newsWriteClient, syncNewsClusters } from "@/lib/news/global-store";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const body = (await request.json().catch(() => ({}))) as { ticker?: string };

    const output = await logAgentRun(supabase, user.id, "news_refresh", { ticker: body.ticker ?? "all" }, async () => {
      const result = await refreshNewsForUser(supabase, user.id, { ticker: body.ticker });
      await refreshAlerts(supabase, user.id);
      const writer = newsWriteClient();
      if (writer) await syncNewsClusters(writer);
      return {
        message: `${result.inserted} article${result.inserted === 1 ? "" : "s"} saved (${result.market} market, ${result.holding} holding-specific).`,
        ...result,
      };
    });

    return NextResponse.json(output);
  } catch (err) {
    return errorResponse(err);
  }
}
