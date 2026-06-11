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
} from "@tanstack/react-table";
import type { EnrichedHolding, PortfolioSummary } from "@/lib/types";
import { formatMoney, formatNumber, formatSignedPct, cn } from "@/lib/utils";
import { Badge, thesisStatusVariant } from "@/components/ui/badge";
import { EditHoldingDialog } from "@/components/edit-holding-dialog";
import { Input } from "@/components/ui/input";
import { ArrowUpDown, Search, X } from "lucide-react";

type ViewTab = "performance" | "income" | "allocation" | "planning";
type QuickFilter =
  | "gainers"
  | "losers"
  | "dividend_payers"
  | "big_loss"
  | "missing_target"
  | "missing_thesis";

const col = createColumnHelper<EnrichedHolding>();

type RowBadge = { label: string; cls: string };

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-base font-bold tabular-nums leading-tight",
          tone === "positive" && "text-emerald-600",
          tone === "negative" && "text-red-600"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "gainers", label: "Gainers" },
  { key: "losers", label: "Losers" },
  { key: "dividend_payers", label: "Dividend payers" },
  { key: "big_loss", label: "Loss >10%" },
  { key: "missing_target", label: "Missing target" },
  { key: "missing_thesis", label: "Missing thesis" },
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
  badges,
}: {
  holding: EnrichedHolding;
  tab: ViewTab;
  badges: RowBadge[];
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
            {badges.map((b) => (
              <span
                key={b.label}
                className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none", b.cls)}
              >
                {b.label}
              </span>
            ))}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {holding.company_name ?? holding.sector ?? "Unclassified"}
          </p>
        </div>
        <EditHoldingDialog holding={holding} />
      </div>

      {tab === "performance" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileMetric label="Market value" value={holding.market_value !== null ? formatMoney(holding.market_value) : "—"} />
          <MobileMetric label="P/L" value={pl !== null ? `${formatNumber(pl, 0)}${plPct !== null ? ` · ${formatSignedPct(plPct)}` : ""}` : "—"} tone={plTone} />
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

export function HoldingsTable({
  holdings,
  summary,
}: {
  holdings: EnrichedHolding[];
  summary: PortfolioSummary;
}) {
  const [tab, setTab] = useState<ViewTab>("performance");
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState(new Set<QuickFilter>());
  const [sorting, setSorting] = useState<SortingState>([{ id: "weight", desc: true }]);

  // Spotlight rows
  const pricedHoldings = holdings.filter((h) => h.unrealized_pl_pct !== null);
  const topGainer =
    [...pricedHoldings]
      .filter((h) => (h.unrealized_pl_pct ?? 0) > 0)
      .sort((a, b) => b.unrealized_pl_pct! - a.unrealized_pl_pct!)[0] ?? null;
  const topLoser =
    [...pricedHoldings]
      .filter((h) => (h.unrealized_pl_pct ?? 0) < 0)
      .sort((a, b) => a.unrealized_pl_pct! - b.unrealized_pl_pct!)[0] ?? null;
  const topDividend =
    [...holdings]
      .filter((h) => h.dividend_income > 0)
      .sort((a, b) => b.dividend_income - a.dividend_income)[0] ?? null;

  const latestPriceDate =
    holdings
      .map((h) => h.price_date)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? null;

  // Pre-compute per-row insight badges
  const rowBadges = useMemo((): Map<string, RowBadge[]> => {
    const map = new Map<string, RowBadge[]>();
    const add = (ticker: string | null | undefined, badge: RowBadge) => {
      if (!ticker) return;
      if (!map.has(ticker)) map.set(ticker, []);
      map.get(ticker)!.push(badge);
    };
    add(summary.largestHolding?.ticker, {
      label: "Top",
      cls: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    });
    add(topGainer?.ticker, {
      label: "Best",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    });
    add(topLoser?.ticker, {
      label: "Worst",
      cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    });
    add(topDividend?.ticker, {
      label: "Div",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    });
    return map;
  }, [
    summary.largestHolding?.ticker,
    topGainer?.ticker,
    topLoser?.ticker,
    topDividend?.ticker,
  ]);

  // Shared ticker+company cell used in every tab
  const makeTickerCell = (h: EnrichedHolding) => {
    const badges = rowBadges.get(h.ticker) ?? [];
    return (
      <div className="min-w-32">
        <div className="flex items-center gap-1">
          <Link
            href={`/stocks/${h.ticker}`}
            className="text-sm font-bold text-foreground hover:underline"
          >
            {h.ticker}
          </Link>
          {badges.map((b) => (
            <span
              key={b.label}
              className={cn("rounded px-1 py-0 text-[9px] font-bold uppercase tracking-wide", b.cls)}
            >
              {b.label}
            </span>
          ))}
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

  // Column sets — depend only on rowBadges (stable via useMemo)
  const allColumns = useMemo(() => {
    const tickerCol = col.accessor("ticker", {
      header: "Holding",
      cell: (c) => makeTickerCell(c.row.original),
    });
    const actionsCol = col.display({
      id: "actions",
      header: "",
      cell: (c) => <EditHoldingDialog holding={c.row.original} />,
    });
    const sectorCol = col.accessor("sector", {
      header: "Sector",
      cell: (c) =>
        c.getValue() ? (
          <span className="block max-w-36 truncate text-xs" title={c.getValue() ?? ""}>
            {c.getValue()}
          </span>
        ) : (
          <span className="text-xs text-amber-600">Unclassified</span>
        ),
    });
    const mktValueCol = col.accessor("market_value", {
      id: "market_value",
      header: "Mkt value",
      cell: (c) => (
        <span className="tabular-nums text-sm">
          {c.getValue() !== null ? formatNumber(c.getValue()!, 0) : "—"}
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
        header: "Avg cost",
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
      mktValueCol,
      col.accessor("unrealized_pl", {
        id: "pl",
        header: "P/L",
        cell: (c) => {
          const pl = c.getValue();
          const pct = c.row.original.unrealized_pl_pct;
          if (pl === null) return <span className="text-sm text-muted-foreground">—</span>;
          const tone = pl > 0 ? "text-emerald-600" : pl < 0 ? "text-red-600" : "";
          return (
            <div className={cn("tabular-nums", tone)}>
              <span className="text-sm font-medium">{formatNumber(pl, 0)}</span>
              {pct !== null && (
                <span className="ml-1.5 text-[11px] opacity-75">{formatSignedPct(pct)}</span>
              )}
            </div>
          );
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
      sectorCol,
      mktValueCol,
      col.accessor("weight", {
        id: "weight_alloc",
        header: "Weight",
        cell: (c) => (
          <span className="tabular-nums text-sm font-medium">
            {c.getValue() !== null ? `${c.getValue()!.toFixed(1)}%` : "—"}
          </span>
        ),
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
      col.display({
        id: "alloc_status",
        header: "Status",
        cell: (c) => {
          const h = c.row.original;
          const status = allocationStatus(h.weight, h.target_allocation);
          if (!status)
            return <span className="text-xs text-muted-foreground">no target</span>;
          return <Badge variant={status.variant}>{status.label}</Badge>;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowBadges]);

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
    if (activeFilters.has("gainers")) rows = rows.filter((h) => (h.unrealized_pl_pct ?? 0) > 0);
    if (activeFilters.has("losers")) rows = rows.filter((h) => (h.unrealized_pl_pct ?? 0) < 0);
    if (activeFilters.has("dividend_payers")) rows = rows.filter((h) => h.dividend_income > 0);
    if (activeFilters.has("big_loss")) rows = rows.filter((h) => (h.unrealized_pl_pct ?? 0) < -10);
    if (activeFilters.has("missing_target"))
      rows = rows.filter((h) => h.target_allocation === null && h.target_price === null);
    if (activeFilters.has("missing_thesis")) rows = rows.filter((h) => !h.has_thesis);
    return rows;
  }, [holdings, search, sectorFilter, activeFilters]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table is the app's table engine; mobile cards consume the same row model.
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const plTone =
    summary.unrealizedPl > 0 ? "positive" : summary.unrealizedPl < 0 ? "negative" : "neutral";
  const tableRows = table.getRowModel().rows;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
        <SummaryCard
          label="Holdings"
          value={formatNumber(summary.holdingsCount, 0)}
          sub={`${summary.pricedHoldings} priced`}
        />
        <SummaryCard label="Market value" value={formatMoney(summary.totalValue)} />
        <SummaryCard
          label="Unrealized P/L"
          value={formatMoney(summary.unrealizedPl)}
          sub={
            summary.unrealizedPlPct !== null
              ? formatSignedPct(summary.unrealizedPlPct)
              : "needs prices"
          }
          tone={plTone}
        />
        <SummaryCard label="Dividend income" value={formatMoney(summary.dividendIncome)} />
        <SummaryCard
          label="Largest holding"
          value={summary.largestHolding?.ticker ?? "—"}
          sub={
            summary.largestHolding?.weight != null
              ? `${summary.largestHolding.weight.toFixed(1)}% of portfolio`
              : undefined
          }
        />
        <SummaryCard
          label="Top gainer"
          value={topGainer?.ticker ?? "—"}
          sub={topGainer ? formatSignedPct(topGainer.unrealized_pl_pct!) : "no data"}
          tone={topGainer ? "positive" : "neutral"}
        />
        <SummaryCard
          label="Top loser"
          value={topLoser?.ticker ?? "—"}
          sub={topLoser ? formatSignedPct(topLoser.unrealized_pl_pct!) : "no data"}
          tone={topLoser ? "negative" : "neutral"}
        />
        <SummaryCard
          label="Top dividend"
          value={topDividend?.ticker ?? "—"}
          sub={topDividend ? formatMoney(topDividend.dividend_income) : "no data"}
        />
      </div>

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

        <div className="scroll-touch -mx-1 flex gap-1.5 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key)}
              className={cn(
                "h-9 shrink-0 rounded-full border px-3 text-[11px] font-medium transition-colors md:h-auto md:px-2.5 md:py-1",
                activeFilters.has(f.key)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/50 hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
          {(activeFilters.size > 0 || sectorFilter || search) && (
            <button
              onClick={() => {
                setSearch("");
                setSectorFilter(null);
                setActiveFilters(new Set());
              }}
              className="h-9 shrink-0 rounded-full border border-border px-3 text-[11px] text-muted-foreground hover:text-foreground md:h-auto md:px-2.5 md:py-1"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

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
                  "h-9 shrink-0 rounded-md px-3 text-xs font-medium transition-colors sm:h-auto sm:py-1.5",
                  tab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {latestPriceDate && (
            <span className="text-[11px] text-muted-foreground sm:text-right">
              Prices as of {latestPriceDate}
            </span>
          )}
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
                badges={rowBadges.get(row.original.ticker) ?? []}
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
                      className="h-9 cursor-pointer select-none whitespace-nowrap px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
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
                      <td key={cell.id} className="whitespace-nowrap px-3 py-2.5 align-middle">
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
          <span>Total market value {formatMoney(summary.totalValue)} · unpriced counted at cost</span>
        </div>
      </div>
    </div>
  );
}
