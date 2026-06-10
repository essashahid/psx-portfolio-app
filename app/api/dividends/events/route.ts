import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { reconcile, round2 } from "@/lib/dividends/engine";
import { takeSnapshot } from "@/lib/portfolio";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm_eligibility"), id: z.string().uuid() }),
  z.object({ action: z.literal("not_eligible"), id: z.string().uuid() }),
  z.object({
    action: z.literal("set_eligible_quantity"),
    id: z.string().uuid(),
    eligible_quantity: z.number().nonnegative(),
  }),
  z.object({ action: z.literal("ignore"), id: z.string().uuid() }),
  z.object({ action: z.literal("watch"), id: z.string().uuid() }),
  z.object({ action: z.literal("confirm"), id: z.string().uuid() }),
  z.object({ action: z.literal("note"), id: z.string().uuid(), notes: z.string().max(1000) }),
  z.object({
    action: z.literal("mark_received"),
    id: z.string().uuid(),
    received_date: date,
    gross_received: z.number().nonnegative(),
    tax_deducted_actual: z.number().nonnegative(),
  }),
]);

export async function PATCH(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    const body = parsed.data;

    const { data: event } = await supabase
      .from("dividend_events")
      .select("*")
      .eq("id", body.id)
      .eq("user_id", user.id)
      .single();
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let message = "Updated.";

    switch (body.action) {
      case "confirm_eligibility":
        patch.eligibility_status = "eligible";
        patch.eligibility_notes = "Eligibility confirmed by user.";
        message = "Eligibility confirmed.";
        break;
      case "not_eligible":
        patch.eligibility_status = "not_eligible";
        patch.status = "not_eligible";
        message = "Marked not eligible.";
        break;
      case "set_eligible_quantity": {
        patch.eligible_quantity = body.eligible_quantity;
        const dps = event.dividend_per_share !== null ? Number(event.dividend_per_share) : null;
        const rate = event.tax_rate !== null ? Number(event.tax_rate) : null;
        if (dps !== null) {
          const gross = round2(body.eligible_quantity * dps);
          patch.gross_expected = gross;
          patch.estimated_tax = rate !== null ? round2(gross * rate) : null;
          patch.net_expected = rate !== null ? round2(gross * (1 - rate)) : null;
        }
        patch.eligibility_status = "eligible";
        patch.eligibility_notes = "Eligible quantity set by user.";
        message = "Eligible quantity updated and amounts recalculated.";
        break;
      }
      case "ignore":
        patch.status = "ignored";
        message = "Event ignored.";
        break;
      case "watch":
        patch.notes = [event.notes, "Watching."].filter(Boolean).join(" ");
        message = "Marked as watching.";
        break;
      case "confirm":
        // Manual conversion: forecast → confirmed expectation, or staged → announced
        patch.is_forecast = false;
        patch.is_confirmed = true;
        patch.status = event.is_forecast ? "expected" : "announced";
        patch.event_type = event.is_forecast ? "manual" : event.event_type;
        message = event.is_forecast ? "Forecast converted to a confirmed expectation." : "Event confirmed.";
        break;
      case "mark_received": {
        const net = round2(body.gross_received - body.tax_deducted_actual);
        const rec = reconcile(
          {
            gross: event.gross_expected !== null ? Number(event.gross_expected) : null,
            net: event.net_expected !== null ? Number(event.net_expected) : null,
          },
          { gross: body.gross_received, tax: body.tax_deducted_actual, net }
        );
        patch.status = "received";
        patch.received_date = body.received_date;
        patch.gross_received = body.gross_received;
        patch.tax_deducted_actual = body.tax_deducted_actual;
        patch.net_received = net;
        patch.actual_tax_rate = rec.actualRate;
        patch.variance_amount = rec.variance;
        patch.is_reconciled = rec.reconciled;

        // Keep income stats working: record the receipt in the dividends ledger
        await supabase.from("dividends").insert({
          user_id: user.id,
          ticker: event.ticker,
          company_name: event.company_name,
          announcement_date: event.announcement_date,
          ex_date: event.ex_date,
          payment_date: body.received_date,
          pay_date: body.received_date,
          dividend_per_share: event.dividend_per_share,
          quantity_held: event.eligible_quantity,
          amount: body.gross_received,
          tax: body.tax_deducted_actual,
          net_amount: net,
          status: "received",
          source: "receivable",
          notes: rec.reconciled
            ? null
            : `Variance vs expected net: ${rec.variance >= 0 ? "+" : ""}${rec.variance.toFixed(0)} PKR`,
          row_hash: `event-${event.id}`,
        });
        message = rec.reconciled
          ? "Marked received and reconciled with the expected amount."
          : `Marked received. Variance vs expected: ${rec.variance >= 0 ? "+" : ""}PKR ${Math.abs(rec.variance).toFixed(0)} — review suggested.`;
        break;
      }
    }

    const { error: updErr } = await supabase
      .from("dividend_events")
      .update(patch)
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (updErr) throw updErr;

    if (body.action === "mark_received") await takeSnapshot(supabase, user.id);
    return NextResponse.json({ ok: true, message });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;
  try {
    const body = (await request.json()) as { id?: string };
    if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const { error: delErr } = await supabase
      .from("dividend_events")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (delErr) throw delErr;
    return NextResponse.json({ ok: true, message: "Event deleted." });
  } catch (err) {
    return errorResponse(err);
  }
}
