"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import type { EnrichedHolding, PortfolioSummary } from "@/lib/types";
import { formatMoney, formatNumber, formatSignedPct, cn } from "@/lib/utils";
import { Badge, thesisStatusVariant } from "@/components/ui/badge";
import { SectorChip } from "@/components/sector-chip";
import { AddTransactionDialog } from "@/components/add-transaction-dialog";
import { GenerateReportDialog } from "@/components/stock/generate-report-dialog";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, ChevronDown, MoreHorizontal, Search, X } from "lucide-react";

type ViewTab = "performance" | "income" | "allocation" | "planning";
type QuickFilter =
  | "in_profit"
  | "below_cost"
  | "positive_today"
  | "negative_today"
  | "dividend_payers"
  | "big_loss"
  | "missing_target"
  | "missing_thesis"
  | "missing_company"
  | "stale_price"
  | "unclassified_sector";

const col = createColumnHelper<EnrichedHolding>();

const PERFORMANCE_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "in_profit", label: "In profit" },
  { key: "below_cost", label: "Below cost" },
  { key: "big_loss", label: "Loss greater than 10%" },
  { key: "positive_today", label: "Positive today" },
  { key: "negative_today", label: "Negative today" },
  { key: "dividend_payers", label: "Dividend payers" },
];

const MORE_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "missing_target", label: "Missing target" },
  { key: "missing_thesis", label: "Missing thesis" },
  { key: "missing_company", label: "Missing company information" },
  { key: "stale_price", label: "Missing or stale price" },
  { key: "unclassified_sector", label: "Unclassified sector" },
];

const TABS: { key: ViewTab; label: string }[] = [
  { key: "performance", label: "Performance" },
  { key: "income", label: "Income" },
  { key: "allocation", label: "Allocation" },
  { key: "planning", label: "Planning" },
];

function allocationStatus(
  weight: number | null,
  target: number | null
): { label: string; variant: "green" | "amber" | "blue" } | null {
  if (weight === null || target === null) return null;
  const drift = weight - target;
  if (drift > 3) return { label: "Overweight", variant: "amber" };
  if (drift < -3) return { label: "Underweight", variant: "blue" };
  return { label: "On target", variant: "green" };
}

function MobileMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "positive" | "negative" | "muted" | "accent";
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background/55 px-2.5 py-2">
      <p className="truncate text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 min-w-0 truncate text-sm font-semibold tabular-nums",
          tone === "positive" && "text-emerald-600",
          tone === "negative" && "text-red-600",
          tone === "muted" && "text-muted-foreground",
          tone === "accent" && "text-amber-600"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MobileHoldingCard({
  holding,
  tab,
}: {
  holding: EnrichedHolding;
  tab: ViewTab;
}) {
  const pl = holding.unrealized_pl;
  const plPct = holding.unrealized_pl_pct;
  const plTone = pl === null ? "muted" : pl > 0 ? "positive" : pl < 0 ? "negative" : undefined;
  const yoc =
    holding.dividend_income && holding.total_cost
      ? `${((holding.dividend_income / holding.total_cost) * 100).toFixed(2)}%`
      : "—";
  const yov =
    holding.dividend_income && holding.market_value
      ? `${((holding.dividend_income / holding.market_value) * 100).toFixed(2)}%`
      : "—";
  const drift =
    holding.weight !== null && holding.target_allocation !== null
      ? holding.weight - holding.target_allocation
      : null;
  const allocStatus = allocationStatus(holding.weight, holding.target_allocation);
  const reviewLabels = ["", "Watch", "Monitor", "Review", "Urgent", "Exit"];

  return (
    <article className="rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Link
              href={`/stocks/${holding.ticker}`}
              className="text-base font-bold leading-tight text-foreground"
            >
              {holding.ticker}
            </Link>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {holding.company_name ?? "—"}
          </p>
          <div className="mt-1">
            <SectorChip sector={holding.sector} size="xs" />
          </div>
        </div>
        <HoldingActionMenu holding={holding} />
      </div>

      {tab === "performance" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileMetric label="Market value" value={holding.market_value !== null ? formatMoney(holding.market_value) : "—"} />
          <MobileMetric label="Unrealised P/L" value={pl !== null ? `${formatMoney(pl)}${plPct !== null ? ` · ${formatSignedPct(plPct)}` : ""}` : "—"} tone={plTone} />
          <MobileMetric label="Price" value={holding.latest_price !== null ? formatNumber(holding.latest_price) : "no price"} tone={holding.latest_price === null ? "accent" : undefined} />
          <MobileMetric label="Weight" value={holding.weight !== null ? `${holding.weight.toFixed(1)}%` : "—"} />
        </div>
      )}

      {tab === "income" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileMetric label="Dividends" value={holding.dividend_income > 0 ? formatMoney(holding.dividend_income) : "—"} tone={holding.dividend_income > 0 ? "accent" : "muted"} />
          <MobileMetric label="Yield cost" value={yoc} />
          <MobileMetric label="Yield value" value={yov} />
          <MobileMetric label="Quantity" value={formatNumber(holding.quantity, 0)} />
        </div>
      )}

      {tab === "allocation" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileMetric label="Weight" value={holding.weight !== null ? `${holding.weight.toFixed(1)}%` : "—"} />
          <MobileMetric label="Target" value={holding.target_allocation !== null ? `${holding.target_allocation}%` : "—"} />
          <MobileMetric
            label="Drift"
            value={drift !== null ? `${drift > 0 ? "+" : ""}${drift.toFixed(1)}%` : "—"}
            tone={drift === null || Math.abs(drift) <= 3 ? "muted" : drift > 0 ? "accent" : undefined}
          />
          <div className="min-w-0 rounded-md border border-border bg-background/55 px-2.5 py-2">
            <p className="truncate text-[10px] font-medium uppercase text-muted-foreground">Status</p>
            <div className="mt-1">
              {allocStatus ? (
                <Badge variant={allocStatus.variant}>{allocStatus.label}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">no target</span>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "planning" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileMetric label="Price" value={holding.latest_price !== null ? formatNumber(holding.latest_price) : "no price"} tone={holding.latest_price === null ? "accent" : undefined} />
          <MobileMetric label="Target" value={holding.target_price !== null ? formatNumber(holding.target_price) : "—"} />
          <MobileMetric
            label="To target"
            value={holding.distance_to_target_pct !== null ? formatSignedPct(holding.distance_to_target_pct) : "—"}
            tone={
              holding.distance_to_target_pct === null
                ? "muted"
                : holding.distance_to_target_pct > 0
                ? "positive"
                : "negative"
            }
          />
          <div className="min-w-0 rounded-md border border-border bg-background/55 px-2.5 py-2">
            <p className="truncate text-[10px] font-medium uppercase text-muted-foreground">Thesis</p>
            <div className="mt-1">
              {holding.has_thesis ? (
                <Badge variant={thesisStatusVariant(holding.thesis_status)}>
                  {holding.thesis_status}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">missing</span>
              )}
            </div>
          </div>
          <MobileMetric
            label="Review"
            value={holding.review_level !== null ? reviewLabels[holding.review_level] ?? holding.review_level : "—"}
          />
          <MobileMetric label="Next review" value={holding.review_date ?? "—"} tone={holding.review_date ? undefined : "muted"} />
        </div>
      )}
    </article>
  );
}

function HoldingActionMenu({ holding }: { holding: EnrichedHolding }) {
  return (
    <details className="relative">
      <summary
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Actions for ${holding.ticker}`}
        title="Holding actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex w-48 flex-col gap-1 rounded-md border border-border bg-card p-1.5 text-xs shadow-[var(--shadow-card)]">
        <Link href={`/stocks/${holding.ticker}`} className="rounded px-2 py-1.5 hover:bg-muted">View company research</Link>
        <GenerateReportDialog
          ticker={holding.ticker}
          companyName={holding.company_name}
          label="Generate company report"
          triggerVariant="ghost"
          triggerSize="sm"
          triggerClassName="h-auto justify-start px-2 py-1.5 text-xs font-normal"
        />
        <AddTransactionDialog defaultTicker={holding.ticker} label="Add transaction" />
        <Link href="/dividends" className="rounded px-2 py-1.5 hover:bg-muted">Record dividend</Link>
        <Link href={`/stocks/${holding.ticker}`} className="rounded px-2 py-1.5 hover:bg-muted">Edit target</Link>
        <Link href={`/stocks/${holding.ticker}`} className="rounded px-2 py-1.5 hover:bg-muted">Edit thesis</Link>
        <Link href={`/journal?ticker=${holding.ticker}`} className="rounded px-2 py-1.5 hover:bg-muted">View transaction history</Link>
        <Link href={`/stocks/${holding.ticker}`} className="rounded px-2 py-1.5 hover:bg-muted">Update company information</Link>
      </div>
    </details>
  );
}

export function HoldingsTable({
  holdings,
  summary,
  dailyRows = [],
}: {
  holdings: EnrichedHolding[];
  summary: PortfolioSummary;
  dailyRows?: { ticker: string; dayChangePct: number | null; dayPnl: number | null }[];
}) {
  const [tab, setTab] = useState<ViewTab>("performance");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState(new Set<QuickFilter>());
  const [sorting, setSorting] = useState<SortingState>([{ id: "weight", desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");

  const dailyByTicker = useMemo(() => new Map(dailyRows.map((row) => [row.ticker, row])), [dailyRows]);

  const latestPriceDate =
    holdings
      .map((h) => h.price_date)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? null;

  // Shared ticker+company cell used in every tab.
  const makeTickerCell = (h: EnrichedHolding) => {
    return (
      <div className="min-w-32">
        <div className="flex items-center gap-1">
          <Link
            href={`/stocks/${h.ticker}`}
            className="text-sm font-bold text-foreground hover:underline"
          >
            {h.ticker}
          </Link>
        </div>
        <p
          className="mt-0.5 max-w-44 truncate text-[11px] text-muted-foreground"
          title={h.company_name ?? ""}
        >
          {h.company_name ?? "—"}
        </p>
      </div>
    );
  };

  // Column sets are task-specific so the table stays readable at normal desktop widths.
  const allColumns = useMemo(() => {
    const tickerCol = col.accessor("ticker", {
      header: "Holding",
      cell: (c) => makeTickerCell(c.row.original),
    });
    const actionsCol = col.display({
      id: "actions",
      header: "",
      cell: (c) => <HoldingActionMenu holding={c.row.original} />,
    });
    const sectorCol = col.accessor("sector", {
      header: "Sector",
      cell: (c) => <SectorChip sector={c.getValue()} />,
    });
    const mktValueCol = col.accessor("market_value", {
      id: "market_value",
      header: "Market value",
      cell: (c) => (
        <span className="tabular-nums text-sm">
          {c.getValue() !== null ? formatMoney(c.getValue()) : "—"}
        </span>
      ),
    });

    const performance = [
      tickerCol,
      sectorCol,
      col.accessor("quantity", {
        header: "Qty",
        cell: (c) => <span className="tabular-nums text-sm">{formatNumber(c.getValue(), 0)}</span>,
      }),
      col.accessor("avg_cost", {
        header: "Average cost",
        cell: (c) => <span className="tabular-nums text-sm">{formatNumber(c.getValue())}</span>,
      }),
      col.accessor("latest_price", {
        header: "Price",
        cell: (c) => {
          const h = c.row.original;
          return c.getValue() !== null ? (
            <span
              className="tabular-nums text-sm"
              title={`${h.price_date ?? ""} · ${h.price_source ?? ""}`}
            >
              {formatNumber(c.getValue())}
            </span>
          ) : (
            <span className="text-xs text-amber-600" title="No price — import or refresh">
              no price
            </span>
          );
        },
      }),
      col.display({
        id: "today",
        header: "Today",
        cell: (c) => {
          const daily = dailyByTicker.get(c.row.original.ticker);
          if (!daily || daily.dayChangePct === null) return <span className="text-sm text-muted-foreground">—</span>;
          const tone = daily.dayChangePct > 0 ? "text-emerald-600" : daily.dayChangePct < 0 ? "text-red-600" : "text-muted-foreground";
          return <span title={daily.dayPnl !== null ? `Portfolio contribution ${formatMoney(daily.dayPnl)}` : "Daily price movement"} className={cn("tabular-nums text-sm font-medium", tone)}>{formatSignedPct(daily.dayChangePct)}</span>;
        },
      }),
      col.accessor("total_cost", {
        header: "Cost basis",
        cell: (c) => <span className="tabular-nums text-sm">{formatMoney(c.getValue())}</span>,
      }),
      mktValueCol,
      col.accessor("unrealized_pl", {
        id: "pl",
        header: "Unrealised P/L",
        cell: (c) => {
          const pl = c.getValue();
          if (pl === null) return <span className="text-sm text-muted-foreground">—</span>;
          const tone = pl > 0 ? "text-emerald-600" : pl < 0 ? "text-red-600" : "";
          return <span className={cn("tabular-nums text-sm font-medium", tone)}>{formatMoney(pl)}</span>;
        },
      }),
      col.display({
        id: "total_return",
        header: "Total return",
        cell: (c) => {
          const h = c.row.original;
          if (!h.total_cost) return <span className="text-sm text-muted-foreground">—</span>;
          const totalReturn = ((h.unrealized_pl ?? 0) + h.dividend_income) / h.total_cost * 100;
          return <span className={cn("tabular-nums text-sm", totalReturn > 0 ? "text-emerald-600" : totalReturn < 0 ? "text-red-600" : "")}>{formatSignedPct(totalReturn)}</span>;
        },
      }),
      col.accessor("weight", {
        id: "weight",
        header: "Weight",
        cell: (c) => (
          <span className="tabular-nums text-sm">
            {c.getValue() !== null ? `${c.getValue()!.toFixed(1)}%` : "—"}
          </span>
        ),
      }),
      actionsCol,
    ];

    const income = [
      tickerCol,
      col.accessor("quantity", {
        id: "qty_income",
        header: "Qty",
        cell: (c) => <span className="tabular-nums text-sm">{formatNumber(c.getValue(), 0)}</span>,
      }),
      mktValueCol,
      col.accessor("dividend_income", {
        header: "Dividends received",
        cell: (c) => {
          const v = c.getValue();
          return (
            <span
              className={cn(
                "tabular-nums text-sm",
                v > 0 ? "font-medium" : "text-muted-foreground"
              )}
            >
              {v > 0 ? formatNumber(v, 0) : "—"}
            </span>
          );
        },
      }),
      col.display({
        id: "yield_on_cost",
        header: "Yield on cost",
        cell: (c) => {
          const h = c.row.original;
          if (!h.dividend_income || !h.total_cost)
            return <span className="text-sm text-muted-foreground">—</span>;
          const yoc = (h.dividend_income / h.total_cost) * 100;
          return <span className="tabular-nums text-sm text-amber-600">{yoc.toFixed(2)}%</span>;
        },
      }),
      col.display({
        id: "yield_on_value",
        header: "Yield on value",
        cell: (c) => {
          const h = c.row.original;
          if (!h.dividend_income || !h.market_value)
            return <span className="text-sm text-muted-foreground">—</span>;
          const yov = (h.dividend_income / h.market_value) * 100;
          return <span className="tabular-nums text-sm text-amber-600">{yov.toFixed(2)}%</span>;
        },
      }),
      actionsCol,
    ];

    const allocation = [
      tickerCol,
      col.display({
        id: "allocation_rank",
        header: "Rank",
        cell: (c) => <span className="tabular-nums text-sm text-muted-foreground">#{[...holdings].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).findIndex((h) => h.ticker === c.row.original.ticker) + 1}</span>,
      }),
      sectorCol,
      mktValueCol,
      col.accessor("weight", {
        id: "weight_alloc",
        header: "Weight",
        cell: (c) => c.getValue() === null ? <span className="text-sm text-muted-foreground">—</span> : <div className="flex min-w-36 items-center gap-2"><span className="w-11 tabular-nums text-sm font-medium">{c.getValue()!.toFixed(1)}%</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(c.getValue()! / Math.max(summary.largestHolding?.weight ?? 1, 1) * 100, 100)}%` }} /></span></div>,
      }),
      col.accessor("target_allocation", {
        header: "Target %",
        cell: (c) => (
          <span className="tabular-nums text-sm">
            {c.getValue() !== null ? `${c.getValue()}%` : "—"}
          </span>
        ),
      }),
      col.display({
        id: "drift",
        header: "Drift",
        cell: (c) => {
          const h = c.row.original;
          if (h.weight === null || h.target_allocation === null)
            return <span className="text-sm text-muted-foreground">—</span>;
          const drift = h.weight - h.target_allocation;
          const cls =
            Math.abs(drift) <= 3
              ? "text-muted-foreground"
              : drift > 0
              ? "text-amber-600"
              : "text-blue-600";
          return (
            <span className={cn("tabular-nums text-sm", cls)}>
              {drift > 0 ? "+" : ""}
              {drift.toFixed(1)}%
            </span>
          );
        },
      }),
      actionsCol,
    ];

    const planning = [
      tickerCol,
      col.accessor("latest_price", {
        id: "price_planning",
        header: "Price",
        cell: (c) =>
          c.getValue() !== null ? (
            <span className="tabular-nums text-sm">{formatNumber(c.getValue())}</span>
          ) : (
            <span className="text-xs text-amber-600">no price</span>
          ),
      }),
      col.accessor("target_price", {
        header: "Target price",
        cell: (c) => (
          <span className="tabular-nums text-sm">
            {c.getValue() !== null ? formatNumber(c.getValue()) : "—"}
          </span>
        ),
      }),
      col.accessor("distance_to_target_pct", {
        header: "To target",
        cell: (c) => {
          const v = c.getValue();
          if (v === null) return <span className="text-sm text-muted-foreground">—</span>;
          const cls =
            Math.abs(v) <= 5
              ? "font-semibold text-amber-600"
              : v > 0
              ? "text-emerald-600"
              : "text-red-600";
          return <span className={cn("tabular-nums text-sm", cls)}>{formatSignedPct(v)}</span>;
        },
      }),
      col.accessor("review_level", {
        header: "Review level",
        cell: (c) => {
          const v = c.getValue();
          if (v === null) return <span className="text-sm text-muted-foreground">—</span>;
          const labels = ["", "Watch", "Monitor", "Review", "Urgent", "Exit"];
          return <span className="text-xs">{labels[v] ?? v}</span>;
        },
      }),
      col.accessor("thesis_status", {
        header: "Thesis",
        cell: (c) =>
          c.row.original.has_thesis ? (
            <Badge variant={thesisStatusVariant(c.getValue())}>{c.getValue()}</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">missing</span>
          ),
      }),
      col.accessor("review_date", {
        header: "Next review",
        cell: (c) => {
          const v = c.getValue();
          if (!v) return <span className="text-sm text-muted-foreground">—</span>;
          const today = new Date().toISOString().slice(0, 10);
          return (
            <span
              className={cn(
                "tabular-nums text-xs",
                v <= today && "font-semibold text-amber-600"
              )}
            >
              {v}
            </span>
          );
        },
      }),
      actionsCol,
    ];

    return { performance, income, allocation, planning };
    // Cells use the latest daily quote map and holding render helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyByTicker]);

  const columns =
    tab === "performance"
      ? allColumns.performance
      : tab === "income"
      ? allColumns.income
      : tab === "allocation"
      ? allColumns.allocation
      : allColumns.planning;

  // Unique sectors for dropdown
  const sectors = useMemo(
    () => [...new Set(holdings.map((h) => h.sector).filter(Boolean))].sort() as string[],
    [holdings]
  );

  function toggleFilter(f: QuickFilter) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  const filtered = useMemo(() => {
    let rows = holdings;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (h) =>
          h.ticker.toLowerCase().includes(q) ||
          (h.company_name ?? "").toLowerCase().includes(q)
      );
    }
    if (sectorFilter) rows = rows.filter((h) => h.sector === sectorFilter);
    if (activeFilters.has("in_profit")) rows = rows.filter((h) => (h.unrealized_pl ?? 0) > 0);
    if (activeFilters.has("below_cost")) rows = rows.filter((h) => (h.unrealized_pl ?? 0) < 0);
    if (activeFilters.has("positive_today")) rows = rows.filter((h) => (dailyByTicker.get(h.ticker)?.dayChangePct ?? 0) > 0);
    if (activeFilters.has("negative_today")) rows = rows.filter((h) => (dailyByTicker.get(h.ticker)?.dayChangePct ?? 0) < 0);
    if (activeFilters.has("dividend_payers")) rows = rows.filter((h) => h.dividend_income > 0);
    if (activeFilters.has("big_loss")) rows = rows.filter((h) => (h.unrealized_pl_pct ?? 0) < -10);
    if (activeFilters.has("missing_target"))
      rows = rows.filter((h) => h.target_allocation === null && h.target_price === null);
    if (activeFilters.has("missing_thesis")) rows = rows.filter((h) => !h.has_thesis);
    if (activeFilters.has("missing_company")) rows = rows.filter((h) => !h.company_name?.trim());
    if (activeFilters.has("stale_price")) rows = rows.filter((h) => !h.price_date || h.price_date !== latestPriceDate);
    if (activeFilters.has("unclassified_sector")) rows = rows.filter((h) => !h.sector?.trim());
    return rows;
  }, [holdings, search, sectorFilter, activeFilters, dailyByTicker, latestPriceDate]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table is the app's table engine; mobile cards consume the same row model.
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const tableRows = table.getRowModel().rows;
  const activeFilterCount = activeFilters.size + Number(!!sectorFilter) + Number(!!search);
  const selectedPerformance = PERFORMANCE_FILTERS.find((item) => activeFilters.has(item.key))?.key ?? "";

  function selectPerformance(value: string) {
    setActiveFilters((previous) => {
      const next = new Set(previous);
      PERFORMANCE_FILTERS.forEach((item) => next.delete(item.key));
      if (value) next.add(value as QuickFilter);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Search + filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-60">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker or company…"
            className="pl-9 md:h-8 md:text-xs"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {sectors.length > 1 && (
          <select
            value={sectorFilter ?? ""}
            onChange={(e) => setSectorFilter(e.target.value || null)}
            className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring md:h-8 md:text-xs"
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select value={selectedPerformance} onChange={(event) => selectPerformance(event.target.value)} className="h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring md:h-8 md:text-xs"><option value="">Performance</option>{PERFORMANCE_FILTERS.map((filter) => <option key={filter.key} value={filter.key}>{filter.label}</option>)}</select>
        <details className="relative">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-1 rounded-md border border-border bg-background px-2 text-sm text-muted-foreground hover:text-foreground md:h-8 md:text-xs">More filters <ChevronDown className="h-3.5 w-3.5" /></summary>
          <div className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">{MORE_FILTERS.map((filter) => <label key={filter.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"><input type="checkbox" checked={activeFilters.has(filter.key)} onChange={() => toggleFilter(filter.key)} />{filter.label}</label>)}</div>
        </details>
      </div>

      {activeFilterCount > 0 && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active · {filtered.length} holding{filtered.length === 1 ? "" : "s"} shown</span><button onClick={() => { setSearch(""); setSectorFilter(null); setActiveFilters(new Set()); }} className="underline underline-offset-2 hover:text-foreground">Clear filters</button></div>}

      {/* Tab bar + table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Tab header */}
        <div className="flex flex-col gap-2 border-b border-border bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="scroll-touch -mx-1 flex gap-1 overflow-x-auto px-1 sm:mx-0 sm:overflow-visible sm:px-0">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "h-9 shrink-0 border-b-2 px-3 text-xs font-medium transition-colors sm:h-auto sm:py-1.5",
                  tab === t.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground sm:ml-auto">
            {latestPriceDate && <span>Prices as of {latestPriceDate}</span>}
            <select value={density} onChange={(event) => setDensity(event.target.value as "compact" | "comfortable")} className="rounded border border-border bg-card px-1.5 py-1 text-[11px] text-foreground"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
            <details className="relative hidden md:block">
              <summary className="cursor-pointer list-none rounded border border-border bg-card px-1.5 py-1 text-[11px] text-foreground">Columns</summary>
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">{table.getAllLeafColumns().filter((column) => !["ticker", "actions"].includes(column.id)).map((column) => <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted"><input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} />{typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}</label>)}</div>
            </details>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="space-y-2.5 p-2.5 md:hidden">
          {tableRows.length === 0 ? (
            <p className="rounded-lg border border-border bg-background py-10 text-center text-sm text-muted-foreground">
              No holdings match the current filters.
            </p>
          ) : (
            tableRows.map((row) => (
              <MobileHoldingCard
                key={row.id}
                holding={row.original}
                tab={tab}
              />
            ))
          )}
        </div>

        {/* Table */}
        <div className="scroll-touch hidden w-full overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-border bg-muted/10">
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn("sticky top-0 z-10 h-9 cursor-pointer select-none whitespace-nowrap bg-card px-3 align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground", header.column.id === "ticker" ? "left-0 z-20 text-left" : ["sector", "actions"].includes(header.column.id) ? "text-left" : "text-right")}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No holdings match the current filters.
                  </td>
                </tr>
              ) : (
                tableRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-0 transition-colors hover:bg-muted/40"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cn("whitespace-nowrap px-3 align-middle", density === "compact" ? "py-1.5" : "py-2.5", cell.column.id === "ticker" ? "sticky left-0 z-10 bg-card text-left group-hover:bg-muted/40" : ["sector", "actions"].includes(cell.column.id) ? "text-left" : "text-right")}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span>
            {filtered.length !== holdings.length
              ? `${filtered.length} of ${holdings.length} holdings`
              : `${holdings.length} holding${holdings.length !== 1 ? "s" : ""}`}
          </span>
          <span>Cost basis {formatMoney(summary.totalCost)} · Market value {formatMoney(summary.totalValue)} · Unrealised P/L {formatMoney(summary.unrealizedPl)} · Portfolio weight 100.0%</span>
        </div>
      </div>
    </div>
  );
}
