"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatSignedPct, cn } from "@/lib/utils";
import type { EnrichedHolding } from "@/lib/types";
import { Loader2, Check } from "lucide-react";

interface RowState {
  target_price: string;
  target_allocation: string;
  review_level: string;
  saving: boolean;
  saved: boolean;
}

export function GoalsEditor({ holdings }: { holdings: EnrichedHolding[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      holdings.map((h) => [
        h.ticker,
        {
          target_price: h.target_price?.toString() ?? "",
          target_allocation: h.target_allocation?.toString() ?? "",
          review_level: h.review_level?.toString() ?? "",
          saving: false,
          saved: false,
        },
      ])
    )
  );

  function set(ticker: string, field: keyof RowState, value: string | boolean) {
    setRows((r) => ({ ...r, [ticker]: { ...r[ticker], [field]: value, saved: field === "saved" ? (value as boolean) : false } }));
  }

  async function save(ticker: string) {
    const row = rows[ticker];
    set(ticker, "saving", true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("targets").upsert(
      {
        user_id: user.id,
        ticker,
        target_price: row.target_price ? parseFloat(row.target_price) : null,
        target_allocation: row.target_allocation ? parseFloat(row.target_allocation) : null,
        review_level: row.review_level ? parseFloat(row.review_level) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,ticker" }
    );
    setRows((r) => ({ ...r, [ticker]: { ...r[ticker], saving: false, saved: true } }));
    fetch("/api/alerts/refresh", { method: "POST" }).finally(() => router.refresh());
  }

  const totalTarget = holdings.reduce((s, h) => {
    const v = parseFloat(rows[h.ticker]?.target_allocation || "");
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <THead>
          <TR>
            <TH>Ticker</TH>
            <TH className="text-right">Latest price</TH>
            <TH className="text-right">Actual weight</TH>
            <TH>Target allocation %</TH>
            <TH>Target price</TH>
            <TH>Review level</TH>
            <TH className="text-right">To target</TH>
            <TH className="text-right">Drift</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {holdings.map((h) => {
            const row = rows[h.ticker];
            const targetAlloc = parseFloat(row.target_allocation || "");
            const drift =
              Number.isFinite(targetAlloc) && h.weight !== null ? h.weight - targetAlloc : null;
            return (
              <TR key={h.ticker}>
                <TD>
                  <Link href={`/stocks/${h.ticker}`} className="font-semibold hover:underline">
                    {h.ticker}
                  </Link>
                </TD>
                <TD className="text-right tabular-nums text-xs">
                  {h.latest_price !== null ? formatNumber(h.latest_price) : "—"}
                </TD>
                <TD className="text-right tabular-nums text-xs">
                  {h.weight !== null ? `${h.weight.toFixed(1)}%` : "—"}
                </TD>
                <TD>
                  <Input
                    className="h-8 w-24 text-xs"
                    type="number" step="any" min="0" max="100"
                    value={row.target_allocation}
                    onChange={(e) => set(h.ticker, "target_allocation", e.target.value)}
                  />
                </TD>
                <TD>
                  <Input
                    className="h-8 w-24 text-xs"
                    type="number" step="any" min="0"
                    value={row.target_price}
                    onChange={(e) => set(h.ticker, "target_price", e.target.value)}
                  />
                </TD>
                <TD>
                  <Input
                    className="h-8 w-24 text-xs"
                    type="number" step="any" min="0"
                    value={row.review_level}
                    onChange={(e) => set(h.ticker, "review_level", e.target.value)}
                  />
                </TD>
                <TD className="text-right text-xs tabular-nums">
                  {h.latest_price !== null && row.target_price
                    ? formatSignedPct(((parseFloat(row.target_price) - h.latest_price) / h.latest_price) * 100)
                    : "—"}
                </TD>
                <TD className={cn("text-right text-xs tabular-nums", drift !== null && Math.abs(drift) >= 5 && "font-semibold text-amber-600")}>
                  {drift !== null ? `${drift > 0 ? "+" : ""}${drift.toFixed(1)}pp` : "—"}
                </TD>
                <TD>
                  <Button size="sm" variant="outline" disabled={row.saving} onClick={() => save(h.ticker)}>
                    {row.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : row.saved ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : "Save"}
                  </Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Target allocations sum to{" "}
        <Badge variant={Math.abs(totalTarget - 100) <= 2 ? "green" : "amber"}>{totalTarget.toFixed(1)}%</Badge>
        {Math.abs(totalTarget - 100) > 2 && " — consider adjusting toward 100%."}
      </div>
    </div>
  );
}
