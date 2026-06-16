"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtPct, tone } from "@/lib/market/format";
import { SUBSCORE_META, type ScoredStock, type SubScoreKey } from "@/lib/market/score";
import { BUCKET_META, type SectorBucket } from "@/lib/market/sectors";
import { Briefcase, Search } from "lucide-react";

/**
 * The Sarmaya-score equivalent: a ranked, filterable shortlist with a
 * transparent sub-score breakdown per name. Sorts/filters entirely in memory.
 */

const SUB_KEYS = Object.keys(SUBSCORE_META) as SubScoreKey[];
const BUCKETS: (SectorBucket | "all")[] = ["all", "energy", "cyclical", "defensive", "financials", "other"];
const PAGE = 25;

function scoreColor(v: number): string {
  // red (low) → amber → emerald (high)
  if (v >= 75) return "bg-emerald-500";
  if (v >= 60) return "bg-emerald-400";
  if (v >= 45) return "bg-amber-400";
  if (v >= 30) return "bg-orange-400";
  return "bg-red-400";
}

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <div className="h-1.5 w-full rounded-full bg-muted" title="No data" />;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" title={value.toFixed(0)}>
      <div className={cn("h-full rounded-full transition-all", scoreColor(value))} style={{ width: `${value}%` }} />
    </div>
  );
}

export function ScoreBoard({ stocks, owned = [] }: { stocks: ScoredStock[]; owned?: string[] }) {
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<SectorBucket | "all">("all");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<"score" | SubScoreKey>("score");
  const [visible, setVisible] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const ownedSet = useMemo(() => new Set(owned.map((t) => t.toUpperCase())), [owned]);
  const hasOwned = ownedSet.size > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    let rows = stocks;
    if (q) rows = rows.filter((s) => s.ticker.includes(q) || (s.companyName ?? "").toUpperCase().includes(q));
    if (bucket !== "all") rows = rows.filter((s) => s.bucket === bucket);
    if (ownedOnly) rows = rows.filter((s) => ownedSet.has(s.ticker));
    const val = (s: ScoredStock) => (sortKey === "score" ? s.score : s.subScores[sortKey] ?? -1);
    return [...rows].sort((a, b) => val(b) - val(a));
  }, [stocks, query, bucket, ownedOnly, ownedSet, sortKey]);

  const shown = filtered.slice(0, visible);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisible(PAGE); }}
            placeholder="Filter by ticker or company…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        {hasOwned && (
          <button
            onClick={() => { setOwnedOnly((v) => !v); setVisible(PAGE); }}
            className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors", ownedOnly ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:text-foreground")}
          >
            <Briefcase className="h-3 w-3" /> Owned
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {BUCKETS.map((b) => (
          <button
            key={b}
            onClick={() => { setBucket(b); setVisible(PAGE); }}
            className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors", bucket === b ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}
          >
            {b === "all" ? "All sectors" : BUCKET_META[b].label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Rank by</span>
          {(["score", ...SUB_KEYS] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setSortKey(k); setVisible(PAGE); }}
              className={cn("flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors", sortKey === k ? "bg-emerald-50 text-emerald-700" : "text-muted-foreground hover:text-foreground")}
            >
              {k === "score" ? "Score" : SUBSCORE_META[k as SubScoreKey].label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">{filtered.length} ranked companies</p>

      {/* Header */}
      <div className="hidden grid-cols-[28px_minmax(0,1.8fr)_56px_repeat(5,minmax(0,1fr))_72px] items-center gap-2 border-b border-border px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
        <span>#</span>
        <span>Company</span>
        <span className="text-center">Score</span>
        {SUB_KEYS.map((k) => <span key={k} className="text-center">{SUBSCORE_META[k].label}</span>)}
        <span className="text-right">Day</span>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">No ranked companies match these filters.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {shown.map((s) => {
            const t = tone(s.changePercent);
            const isOpen = expanded === s.ticker;
            const isOwned = ownedSet.has(s.ticker);
            return (
              <div key={s.ticker}>
                <button
                  onClick={() => setExpanded(isOpen ? null : s.ticker)}
                  className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 lg:grid-cols-[28px_minmax(0,1.8fr)_56px_repeat(5,minmax(0,1fr))_72px]"
                >
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">{s.rank}</span>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold">{s.ticker}</span>
                        {isOwned && <Briefcase className="h-3 w-3 text-emerald-600" aria-label="Owned" />}
                        <span className="rounded bg-muted px-1 text-[8px] font-semibold uppercase text-muted-foreground">{BUCKET_META[s.bucket].label}</span>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">{s.companyName ?? s.sector ?? ""}</p>
                    </div>
                  </div>
                  <div className="hidden items-center justify-center lg:flex">
                    <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold tabular-nums text-white", scoreColor(s.score))}>{s.score.toFixed(0)}</span>
                  </div>
                  {SUB_KEYS.map((k) => (
                    <div key={k} className="hidden px-1 lg:block">
                      <ScoreBar value={s.subScores[k]} />
                    </div>
                  ))}
                  <div className="text-right">
                    <span className={cn("inline-block rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums lg:bg-transparent lg:px-0", t === "positive" ? "bg-emerald-50 text-emerald-700 lg:text-emerald-600" : t === "negative" ? "bg-red-50 text-red-700 lg:text-red-600" : "text-muted-foreground")}>{fmtPct(s.changePercent)}</span>
                    <span className={cn("ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold tabular-nums text-white lg:hidden", scoreColor(s.score))}>
                      {s.score.toFixed(0)}
                    </span>
                  </div>
                </button>

                {isOpen && <ScoreDetail s={s} />}
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > visible && (
        <div className="text-center">
          <button onClick={() => setVisible((v) => v + PAGE)} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium transition-colors hover:bg-muted">
            Show more ({filtered.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  );
}

function metricRow(label: string, value: number | null, fmt: (v: number) => string): { label: string; value: string } {
  return { label, value: value != null && Number.isFinite(value) ? fmt(value) : "—" };
}

function ScoreDetail({ s }: { s: ScoredStock }) {
  const m = s.metrics;
  const pe = (v: number) => v.toFixed(1);
  const pc = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
  const fundamentals = [
    metricRow("EPS growth", m.epsGrowth, pc),
    metricRow("Revenue growth", m.revenueGrowth, pc),
    metricRow("ROE", m.roe, pc),
    metricRow("ROIC", m.roic, pc),
    metricRow("Net margin", m.netMargin, pc),
    metricRow("FCF yield", m.fcfYield, pc),
    metricRow("OCF / PAT", m.ocfToPat, pe),
    metricRow("Accrual ratio", m.accrualRatio, pe),
  ];
  const valuation = [
    metricRow("P/E", m.pe, pe),
    metricRow("P/B", m.pb, pe),
    metricRow("P/S", m.ps, pe),
    metricRow("EV/Sales", m.evSales, pe),
    metricRow("EV/EBIT", m.evEbit, pe),
    metricRow("Dividend yield", m.dividendYield, pc),
    metricRow("Debt / equity", m.debtToEquity, pe),
    metricRow("Net debt / equity", m.netDebtToEquity, pe),
  ];
  const technicals = [
    metricRow("vs 50-day MA", m.pctVsMa50, pc),
    metricRow("vs 200-day MA", m.pctVsMa200, pc),
    metricRow("From 52w high", m.distFromHigh, pc),
    metricRow("RSI (14)", m.rsi, (v) => v.toFixed(0)),
  ];
  return (
    <div className="grid gap-4 border-t border-border bg-muted/30 px-4 py-3 xl:grid-cols-4">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sub-scores</p>
        <div className="space-y-1.5">
          {(Object.keys(SUBSCORE_META) as SubScoreKey[]).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] capitalize">{SUBSCORE_META[k].label}</span>
              <ScoreBar value={s.subScores[k]} />
              <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{s.subScores[k] != null ? s.subScores[k]!.toFixed(0) : "—"}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Quality & growth</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {fundamentals.map((r) => (
            <div key={r.label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Value & leverage</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {valuation.map((r) => (
            <div key={r.label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Technical state</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {technicals.map((r) => (
            <div key={r.label} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
        <Link href={`/stocks/${s.ticker}`} className="mt-2 inline-block text-[11px] font-medium text-emerald-600 hover:underline">
          Open {s.ticker} cockpit →
        </Link>
      </div>
    </div>
  );
}
