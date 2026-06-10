import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/api-helpers";
import { getPortfolio } from "@/lib/portfolio";
import { toCsv } from "@/lib/utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> }
) {
  const { supabase, user, error } = await requireUser();
  if (error) return error;

  try {
    const { kind } = await params;
    let rows: Record<string, unknown>[] = [];
    if (kind === "holdings") {
      const summary = await getPortfolio(supabase, user.id);
      rows = summary.holdings.map((h) => ({
        ticker: h.ticker,
        company_name: h.company_name,
        sector: h.sector,
        quantity: h.quantity,
        avg_cost: h.avg_cost,
        total_cost: h.total_cost,
        latest_price: h.latest_price,
        market_value: h.market_value,
        unrealized_pl: h.unrealized_pl,
        unrealized_pl_pct: h.unrealized_pl_pct?.toFixed(2),
        weight_pct: h.weight?.toFixed(2),
        target_price: h.target_price,
        target_allocation: h.target_allocation,
        dividend_income: h.dividend_income,
        thesis_status: h.thesis_status,
        source: h.source,
      }));
    } else if (kind === "transactions") {
      const { data } = await supabase
        .from("transactions")
        .select("ticker, trade_date, settlement_date, type, quantity, price, gross_amount, commission, tax, net_amount, realized_pl, source, notes")
        .eq("user_id", user.id)
        .order("trade_date", { ascending: true });
      rows = data ?? [];
    } else if (kind === "dividends") {
      const { data } = await supabase
        .from("dividends")
        .select("ticker, pay_date, amount, tax, net_amount, source, notes")
        .eq("user_id", user.id)
        .order("pay_date", { ascending: true });
      rows = data ?? [];
    } else if (kind === "journal") {
      const { data } = await supabase
        .from("journal_entries")
        .select("entry_date, ticker, entry_type, title, body, expected_outcome, risk, confidence, follow_up_date, outcome, lessons")
        .eq("user_id", user.id)
        .order("entry_date", { ascending: true });
      rows = data ?? [];
    } else {
      return NextResponse.json({ error: "Unknown export kind" }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: `Nothing to export for ${kind}.` }, { status: 422 });
    }

    const csv = toCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="portfolioos_${kind}_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
