import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ingestForeignFlows,
  parseSectorLines,
  parseParticipantLines,
  parseAmount,
  type FlowIngestPayload,
} from "@/lib/market/foreign-flows-ingest";

export const dynamic = "force-dynamic";

/**
 * Manual FIPI/LIPI upload. Any signed-in owner can post the day's numbers from
 * the NCCPL report; the write goes through the service role since the
 * foreign_flow_* tables are shared market data (authenticated-read, no per-user
 * rows). Accepts a structured form payload:
 *   { date, currency?, fipiNet?, fipiBuy?, fipiSell?, sectorsText?, participantsText?, note? }
 * sectorsText / participantsText are forgiving "Sector, net" lines (one per row).
 */
export async function POST(request: Request) {
  const { user, error } = await requireUser();
  if (error) return error;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      date?: string;
      currency?: string;
      fipiNet?: string | number | null;
      fipiBuy?: string | number | null;
      fipiSell?: string | number | null;
      sectorsText?: string;
      participantsText?: string;
      note?: string;
    };

    const date = (body.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "A date (YYYY-MM-DD) is required." }, { status: 400 });
    }

    const toNum = (v: string | number | null | undefined): number | null =>
      v == null || v === "" ? null : typeof v === "number" ? v : parseAmount(String(v));

    const sectors = parseSectorLines(body.sectorsText);
    const participants = parseParticipantLines(body.participantsText);
    const fipiNet = toNum(body.fipiNet);

    if (fipiNet == null && (sectors?.length ?? 0) === 0 && (participants?.length ?? 0) === 0) {
      return NextResponse.json({ error: "Provide at least a FIPI net figure or some sector/participant lines." }, { status: 400 });
    }

    const payload: FlowIngestPayload = {
      date,
      currency: body.currency?.trim() || "USD",
      fipi: { net: fipiNet, grossBuy: toNum(body.fipiBuy), grossSell: toNum(body.fipiSell) },
      sectors,
      participants,
      sourceProvider: "manual",
      note: body.note?.trim() || null,
    };

    const admin = createAdminClient();
    const result = await ingestForeignFlows(admin, payload, { ingestedBy: "manual" });
    return NextResponse.json({ ok: true, by: user.id, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
