import { ArrowDownRight, ArrowUpRight, Globe2, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ForeignFlowSnapshot } from "@/lib/market/foreign-flows";

/**
 * Foreign / local investor flow (FIPI / LIPI) visual — the PSX "smart money"
 * read. Server-rendered diverging bars (green = net foreign buying, red = net
 * selling) so it paints instantly with no client bundle. Used full-width on
 * Market Pulse and as a compact strip inside Bulls & Bears.
 */

function fmtFlow(v: number | null | undefined, withSign = true): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = withSign && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}`;
}

function StanceBadge({ stance, label }: { stance: ForeignFlowSnapshot["stance"]; label: string }) {
  const Icon = stance === "accumulating" ? ArrowUpRight : stance === "distributing" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        stance === "accumulating"
          ? "bg-emerald-50 text-emerald-700"
          : stance === "distributing"
            ? "bg-red-50 text-red-700"
            : "bg-muted text-muted-foreground"
      )}
    >
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

/** A single diverging bar around a centre line, scaled to the largest absolute value. */
function DivergingBar({ label, value, max, unit }: { label: string; value: number | null; max: number; unit: string }) {
  const v = value ?? 0;
  const pct = max > 0 ? Math.min(100, (Math.abs(v) / max) * 100) : 0;
  const positive = v > 0;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-28 shrink-0 truncate text-muted-foreground" title={label}>{label}</span>
      <div className="flex h-4 flex-1 items-center">
        <div className="flex h-full w-1/2 justify-end">
          {!positive && v !== 0 && <div className="h-full rounded-l-sm bg-red-500/80" style={{ width: `${pct}%` }} />}
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex h-full w-1/2 justify-start">
          {positive && <div className="h-full rounded-r-sm bg-emerald-500/80" style={{ width: `${pct}%` }} />}
        </div>
      </div>
      <span className={cn("w-14 shrink-0 text-right font-semibold tabular-nums", positive ? "text-emerald-600" : v < 0 ? "text-red-600" : "text-muted-foreground")}>
        {fmtFlow(value)}
      </span>
      <span className="hidden w-12 shrink-0 text-[10px] text-muted-foreground sm:inline">{unit}</span>
    </div>
  );
}

export function ForeignFlows({ snapshot, compact = false }: { snapshot: ForeignFlowSnapshot; compact?: boolean }) {
  const { day, sectors, buckets, participants, cumulativeNet, stance, stanceLabel } = snapshot;
  const unit = `${day.currency} mn`;
  const sectorMax = Math.max(0, ...sectors.map((s) => Math.abs(s.net ?? 0)));
  const bucketMax = Math.max(0, ...buckets.map((b) => Math.abs(b.net)));
  const partMax = Math.max(0, ...participants.map((p) => Math.abs(p.net ?? 0)));

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div>
            <p className="eyebrow flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" /> Net foreign (FIPI), {day.date}</p>
            <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums tracking-tight", (day.fipiNet ?? 0) > 0 ? "text-emerald-600" : (day.fipiNet ?? 0) < 0 ? "text-red-600" : "")}>
              {fmtFlow(day.fipiNet)} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StanceBadge stance={stance} label={stanceLabel} />
          {cumulativeNet != null && (
            <span className="text-[11px] text-muted-foreground">
              {snapshot.series.length}-day cumulative <span className={cn("font-semibold tabular-nums", cumulativeNet > 0 ? "text-emerald-600" : cumulativeNet < 0 ? "text-red-600" : "")}>{fmtFlow(cumulativeNet)} {unit}</span>
            </span>
          )}
        </div>
      </div>

      {(day.fipiGrossBuy != null || day.fipiGrossSell != null) && (
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-emerald-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-emerald-700/80">Gross buy</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-700">{fmtFlow(day.fipiGrossBuy, false)} {unit}</p>
          </div>
          <div className="rounded-lg bg-red-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-red-700/80">Gross sell</p>
            <p className="text-sm font-semibold tabular-nums text-red-700">{fmtFlow(day.fipiGrossSell, false)} {unit}</p>
          </div>
        </div>
      )}

      {/* Regime-bucket view (always shown when we have sector data) */}
      {buckets.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Where foreigners moved, by regime bucket</p>
          {buckets.map((b) => (
            <DivergingBar key={b.bucket} label={b.label} value={b.net} max={bucketMax} unit={unit} />
          ))}
        </div>
      )}

      {/* Full sector detail (skipped in compact mode) */}
      {!compact && sectors.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-[11px] font-medium text-muted-foreground">By sector</p>
          {sectors.slice(0, 14).map((s) => (
            <DivergingBar key={s.sector} label={s.sector} value={s.net} max={sectorMax} unit={unit} />
          ))}
        </div>
      )}

      {/* Local participants (LIPI) */}
      {!compact && participants.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-[11px] font-medium text-muted-foreground">Local investors (LIPI), net</p>
          {participants.slice(0, 8).map((p) => (
            <DivergingBar key={p.category} label={p.label} value={p.net} max={partMax} unit={unit} />
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Source: {day.sourceProvider === "manual" ? "manual entry" : day.sourceProvider} · {day.ingestedBy === "auto" ? "auto-fetched" : "uploaded"}
        {day.note ? ` · ${day.note}` : ""}. Positive = net foreign buying. Figures in {unit}.
      </p>
    </div>
  );
}
