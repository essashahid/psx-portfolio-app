"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import type { EnrichedHolding } from "@/lib/types";
import { formatMoney, formatNumber, formatSignedPct, cn } from "@/lib/utils";
import { Badge, thesisStatusVariant } from "@/components/ui/badge";
import { EditHoldingDialog } from "@/components/edit-holding-dialog";
import { ArrowUpDown } from "lucide-react";

const col = createColumnHelper<EnrichedHolding>();

export function HoldingsTable({ holdings }: { holdings: EnrichedHolding[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "weight", desc: true }]);

  const columns = useMemo(
    () => [
      col.accessor("ticker", {
        header: "Ticker",
        cell: (c) => (
          <Link href={`/stocks/${c.getValue()}`} className="font-semibold text-foreground hover:underline">
            {c.getValue()}
          </Link>
        ),
      }),
      col.accessor("company_name", {
        header: "Company",
        cell: (c) => (
          <span className="block max-w-[180px] truncate text-xs text-muted-foreground" title={c.getValue() ?? ""}>
            {c.getValue() ?? "—"}
          </span>
        ),
      }),
      col.accessor("sector", {
        header: "Sector",
        cell: (c) => <span className="block max-w-[140px] truncate text-xs">{c.getValue() ?? "—"}</span>,
      }),
      col.accessor("quantity", {
        header: "Qty",
        cell: (c) => <span className="tabular-nums">{formatNumber(c.getValue(), 0)}</span>,
      }),
      col.accessor("avg_cost", {
        header: "Avg cost",
        cell: (c) => <span className="tabular-nums">{formatNumber(c.getValue())}</span>,
      }),
      col.accessor("total_cost", {
        header: "Total cost",
        cell: (c) => <span className="tabular-nums">{formatNumber(c.getValue(), 0)}</span>,
      }),
      col.accessor("latest_price", {
        header: "Price",
        cell: (c) => {
          const h = c.row.original;
          return c.getValue() !== null ? (
            <span className="tabular-nums" title={`as of ${h.price_date} (${h.price_source})`}>
              {formatNumber(c.getValue())}
            </span>
          ) : (
            <span className="text-xs text-amber-600" title="No price data — set one in Settings or import a statement with market prices">
              no price
            </span>
          );
        },
      }),
      col.accessor("market_value", {
        header: "Mkt value",
        cell: (c) => <span className="tabular-nums">{c.getValue() !== null ? formatNumber(c.getValue(), 0) : "—"}</span>,
      }),
      col.accessor("unrealized_pl", {
        header: "Unreal. P/L",
        cell: (c) => {
          const v = c.getValue();
          if (v === null) return <span className="text-muted-foreground">—</span>;
          return (
            <span className={cn("tabular-nums font-medium", v > 0 ? "text-emerald-600" : v < 0 ? "text-red-600" : "")}>
              {formatNumber(v, 0)}
            </span>
          );
        },
      }),
      col.accessor("unrealized_pl_pct", {
        header: "P/L %",
        cell: (c) => {
          const v = c.getValue();
          if (v === null) return <span className="text-muted-foreground">—</span>;
          return (
            <span className={cn("tabular-nums", v > 0 ? "text-emerald-600" : v < 0 ? "text-red-600" : "")}>
              {formatSignedPct(v)}
            </span>
          );
        },
      }),
      col.accessor("weight", {
        id: "weight",
        header: "Weight",
        cell: (c) => <span className="tabular-nums">{c.getValue() !== null ? `${c.getValue()!.toFixed(1)}%` : "—"}</span>,
      }),
      col.accessor("target_allocation", {
        header: "Target %",
        cell: (c) => <span className="tabular-nums">{c.getValue() !== null ? `${c.getValue()}%` : "—"}</span>,
      }),
      col.accessor("target_price", {
        header: "Target price",
        cell: (c) => <span className="tabular-nums">{c.getValue() !== null ? formatNumber(c.getValue()) : "—"}</span>,
      }),
      col.accessor("distance_to_target_pct", {
        header: "To target",
        cell: (c) => {
          const v = c.getValue();
          if (v === null) return <span className="text-muted-foreground">—</span>;
          return (
            <span className={cn("tabular-nums text-xs", Math.abs(v) <= 5 && "font-semibold text-amber-600")}>
              {formatSignedPct(v)}
            </span>
          );
        },
      }),
      col.accessor("dividend_income", {
        header: "Dividends",
        cell: (c) => <span className="tabular-nums">{c.getValue() ? formatNumber(c.getValue(), 0) : "—"}</span>,
      }),
      col.accessor("thesis_status", {
        header: "Thesis",
        cell: (c) =>
          c.row.original.has_thesis ? (
            <Badge variant={thesisStatusVariant(c.getValue())}>{c.getValue()}</Badge>
          ) : (
            <Badge variant="amber">missing</Badge>
          ),
      }),
      col.accessor("review_date", {
        header: "Review",
        cell: (c) => {
          const v = c.getValue();
          if (!v) return <span className="text-muted-foreground">—</span>;
          const due = v <= new Date().toISOString().slice(0, 10);
          return <span className={cn("text-xs tabular-nums", due && "font-semibold text-amber-600")}>{v}</span>;
        },
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => <EditHoldingDialog holding={c.row.original} />,
      }),
    ],
    []
  );

  const table = useReactTable({
    data: holdings,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-9 cursor-pointer select-none whitespace-nowrap px-2.5 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <span className="inline-flex items-center gap-1">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    <ArrowUpDown className="h-3 w-3 opacity-40" />
                  </span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="whitespace-nowrap px-2.5 py-2 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Total market value {formatMoney(holdings.reduce((s, h) => s + (h.market_value ?? h.total_cost), 0))} · unpriced holdings counted at cost
      </p>
    </div>
  );
}
