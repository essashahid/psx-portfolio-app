import { NextResponse } from "next/server";
import { track } from "@/lib/telemetry/events";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/shared/api";
import { rejectDemoWrite } from "@/lib/demo/mode";
import { quickAddHolding, QuickAddError } from "@/lib/portfolio/quick-add";
import type { HoldingQuickAddRequest } from "@psx/shared/api/holdings";

export const maxDuration = 60;

const schema = z.object({
  ticker: z.string().min(2).max(10),
  quantity: z.number().positive(),
  avgCost: z.number().positive().nullable(),
});

/**
 * POST /api/holdings/quick-add
 * Onboarding's "Add what you own". See lib/portfolio/quick-add.ts for the
 * two paths (ledger BUY when the cost is known, manual row when it is not).
 */
export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  const demoError = await rejectDemoWrite(supabase, user.id);
  if (demoError) return demoError;

  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        { status: 422 }
      );
    }
    const body: HoldingQuickAddRequest = parsed.data;
    const result = await quickAddHolding(supabase, user.id, body);
    void track(user.id, "holding_added", { method: "quick-add", path: result.path });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof QuickAddError) return NextResponse.json({ error: err.message }, { status: err.status });
    return errorResponse(err);
  }
}
