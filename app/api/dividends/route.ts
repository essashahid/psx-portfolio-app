import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { refreshAlerts } from "@/lib/alerts";
import { takeSnapshot } from "@/lib/portfolio";

export const maxDuration = 60;

const statusSchema = z.enum(["announced", "expected", "received", "missing"]);

const dividendSchema = z.object({
  id: z.string().uuid().optional(),
  ticker: z.string().min(1).max(12),
  company_name: z.string().max(160).optional().nullable(),
  announcement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  ex_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  dividend_per_share: z.number().nonnegative().optional().nullable(),
  quantity_held: z.number().nonnegative().optional().nullable(),
  amount: z.number().nonnegative(),
  tax: z.number().nonnegative().optional().nullable(),
  net_amount: z.number().nonnegative().optional().nullable(),
  status: statusSchema.default("received"),
  notes: z.string().max(500).optional().nullable(),
});

export async function POST(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const parsed = dividendSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 422 });
    }
    const d = normalizePayload(parsed.data);
    const { error: insErr } = await supabase.from("dividends").insert({
      user_id: user.id,
      ...d,
      pay_date: d.payment_date,
      row_hash: `manual-dividend-${user.id}-${d.ticker}-${Date.now()}`,
      source: "manual",
    });
    if (insErr) throw insErr;
    await takeSnapshot(supabase, user.id);
    await refreshAlerts(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Dividend recorded." });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const parsed = dividendSchema.safeParse(await request.json());
    if (!parsed.success || !parsed.data.id) {
      return NextResponse.json({ error: "Valid dividend id and fields are required." }, { status: 422 });
    }
    const { id, ...payload } = parsed.data;
    const d = normalizePayload(payload);
    const { error: updErr } = await supabase
      .from("dividends")
      .update({ ...d, pay_date: d.payment_date })
      .eq("id", id)
      .eq("user_id", user.id);
    if (updErr) throw updErr;
    await takeSnapshot(supabase, user.id);
    await refreshAlerts(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Dividend updated." });
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
    const { error: delErr } = await supabase.from("dividends").delete().eq("id", body.id).eq("user_id", user.id);
    if (delErr) throw delErr;
    await takeSnapshot(supabase, user.id);
    await refreshAlerts(supabase, user.id);
    return NextResponse.json({ ok: true, message: "Dividend deleted." });
  } catch (err) {
    return errorResponse(err);
  }
}

function normalizePayload(d: Omit<z.infer<typeof dividendSchema>, "id">) {
  const ticker = d.ticker.toUpperCase().trim();
  const tax = d.tax ?? 0;
  const net = d.net_amount ?? Math.max(0, d.amount - tax);
  return {
    ticker,
    company_name: d.company_name || null,
    announcement_date: d.announcement_date || null,
    ex_date: d.ex_date || null,
    payment_date: d.payment_date || null,
    dividend_per_share: d.dividend_per_share ?? null,
    quantity_held: d.quantity_held ?? null,
    amount: d.amount,
    tax,
    net_amount: net,
    status: d.status,
    notes: d.notes || null,
  };
}
