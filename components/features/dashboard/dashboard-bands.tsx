"use client";

import { useState } from "react";
import { cn, formatNumber } from "@/lib/shared/format";
import { sectorColor, shortSector } from "@/lib/shared/sector-colors";

const signed = (v: number, d = 0) => `${v < 0 ? "−" : "+"}${formatNumber(Math.abs(v), d)}`;

/* ── Daily contribution: center-zero diverging ledger ───────────────────── */
export interface ContributionRow {
  ticker: string;
  sector: string | null;
  contrib: number;
  pricePct: number | null;
  weight: number | null;
}

export function ContributionLedger({ rows }: { rows: ContributionRow[] }) {
  const sorted = [...rows].sort((a, b) => b.contrib - a.contrib);
  const max = Math.max(...sorted.map((r) => Math.abs(r.contrib)), 1);
  if (sorted.length === 0) {
    return <p className="py-10 text-center text-sm text-text-muted">No priced holdings today.</p>;
  }
  return (
    <div className="ledger">
      {sorted.map((r) => {
        const w = (Math.abs(r.contrib) / max) * 48;
        return (
          <div key={r.ticker} className="ledger-row grid items-center gap-3.5" style={{ gridTemplateColumns: "96px 1fr 92px" }}>
            <span>
              <span className="block text-sm font-semibold text-text-strong">{r.ticker}</span>
              <span className="figure block text-(length:--text-3xs) text-text-faint">
                {r.pricePct !== null ? `${signed(r.pricePct, 2)}% price` : "no price"} · {r.weight !== null ? `${formatNumber(r.weight, 1)}% weight` : "—"}
              </span>
            </span>
            <span className="relative block h-2">
              <span className="absolute inset-y-0 left-1/2 w-px bg-rule" />
              <span
                className="absolute top-0 h-2"
                style={{
                  left: r.contrib >= 0 ? "50%" : `${50 - w}%`,
                  width: `${w}%`,
                  background: r.contrib >= 0 ? sectorColor(r.sector) : "var(--down-2)",
                }}
              />
            </span>
            <span className={cn("figure text-right text-xs font-semibold", r.contrib >= 0 ? "text-up" : "text-down")}>
              {signed(r.contrib, 0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Portfolio allocation + the active-weight bet against the index ─────── */
export interface AllocationSlice {
  label: string;
  fullLabel: string;
  sector: string | null;
  value: number;
  weight: number;
  meta: string;
}

export interface ActiveWeightRow {
  sector: string;
  mineW: number;
  idxW: number;
}

export function AllocationPanel({
  sectors,
  holdings,
  activeWeights,
  totalValue,
}: {
  sectors: AllocationSlice[];
  holdings: AllocationSlice[];
  activeWeights: ActiveWeightRow[];
  totalValue: number;
}) {
  const [view, setView] = useState<"sector" | "holding">("sector");
  const rows = view === "sector" ? sectors : holdings;
  const top = rows[0]?.value || 1;
  const aRows = [...activeWeights].sort((a, b) => b.mineW - b.idxW - (a.mineW - a.idxW));
  const aMax = Math.max(...aRows.map((r) => Math.abs(r.mineW - r.idxW)), 1);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 border-b border-rule pb-2.5">
        <h2 className="font-display text-(length:--text-h2) font-normal tracking-editorial text-text-strong">Portfolio allocation</h2>
        <div className="flex gap-4">
          {(["sector", "holding"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn(
                "border-b-2 pb-1.5 text-sm capitalize transition-colors",
                view === id ? "border-indigo font-bold text-text-strong" : "border-transparent font-medium text-text-muted hover:text-text-strong"
              )}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <div className="ledger">
        {rows.map((r) => (
          <div key={r.label} className="ledger-row flex flex-col gap-[5px]">
            <span className="flex items-baseline gap-2.5">
              <span title={r.fullLabel} className="min-w-0 flex-1 truncate text-xs text-text-strong">{r.label}</span>
              <span className="figure text-xs text-text-muted">{formatNumber(r.value, 0)}</span>
              <span className="figure w-[46px] text-right text-xs font-semibold text-text-strong">{formatNumber(r.weight, 1)}%</span>
              <span className="w-[78px] text-right text-(length:--text-3xs) text-text-faint">{r.meta}</span>
            </span>
            <span className="block h-[5px] bg-surface-inset">
              <span className="block h-[5px]" style={{ width: `${(r.value / top) * 100}%`, background: sectorColor(r.sector) }} />
            </span>
          </div>
        ))}
      </div>

      {aRows.length > 0 && totalValue > 0 && (
        <div className="mt-7 border-t border-rule pt-5">
          <p className="mb-1 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Your bet against the index</p>
          <p className="mb-4 text-xs text-text-muted">Sector weight in your book, less its weight in the KSE-100</p>
          <div className="flex flex-col gap-2">
            {aRows.map((r) => {
              const active = r.mineW - r.idxW;
              const flat = Math.abs(active) < 0.05;
              const half = flat ? 0 : (Math.abs(active) / aMax) * 48;
              return (
                <div
                  key={r.sector}
                  title={`${shortSector(r.sector)} · you ${formatNumber(r.mineW, 1)}% against ${formatNumber(r.idxW, 1)}% of the index`}
                  className="grid items-center gap-3"
                  style={{ gridTemplateColumns: "78px 1fr 62px" }}
                >
                  <span className="truncate text-xs text-text-muted">{shortSector(r.sector)}</span>
                  <span className="relative h-4">
                    <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
                    <span
                      className="absolute top-[3px] h-2.5"
                      style={{
                        left: active >= 0 ? "50%" : `${50 - half}%`,
                        width: `${half}%`,
                        background: sectorColor(r.sector),
                      }}
                    />
                  </span>
                  <span className={cn("figure text-right text-xs font-semibold", flat ? "text-text-muted" : active >= 0 ? "text-up" : "text-down")}>
                    {flat ? "in line" : `${signed(active, 1)}pp`}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2.5 flex justify-between pl-[90px] pr-[74px]">
            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Underweight</span>
            <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">Overweight</span>
          </div>
        </div>
      )}
    </div>
  );
}
