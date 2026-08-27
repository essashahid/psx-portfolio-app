import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/shared/api";
import type { AlertRow, AlertsResponse, AlertSeverity, AlertStatus } from "@psx/shared/api/alerts";

/**
 * Triggered alerts, for the mobile More tab.
 *
 * `?view=history` returns everything already dealt with; the default is the
 * open list, which is the only one worth a glance on a phone.
 */
export async function GET(request: Request) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  const history = new URL(request.url).searchParams.get("view") === "history";

  try {
    let query = supabase
      .from("alerts")
      .select("id, ticker, alert_type, severity, title, message, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(80);
    query = history ? query.neq("status", "open") : query.eq("status", "open");

    const { data, error: dbError } = await query;
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

    const rows: AlertRow[] = (data ?? []).map((a) => ({
      id: a.id,
      ticker: a.ticker,
      alertType: a.alert_type,
      severity: a.severity as AlertSeverity,
      title: a.title,
      message: a.message,
      status: a.status as AlertStatus,
      createdAt: a.created_at,
    }));

    const body: AlertsResponse = {
      rows,
      openCount: history ? 0 : rows.length,
    };
    return NextResponse.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}
