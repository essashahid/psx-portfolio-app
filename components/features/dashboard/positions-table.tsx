import Link from "next/link";
import { cn, formatNumber } from "@/lib/shared/format";
import { SectorDot } from "@/components/shared/sector-chip";
import { shortSector } from "@/lib/shared/sector-colors";
import { Sparkline } from "@/components/shared/sparkline";

export interface PositionRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  qty: number;
  avg: number | null;
  /** Added without a purchase price; the average cost column says so. */
  costUnknown?: boolean;
  price: number | null;
  dayPct: number | null;
  value: number | null;
  weight: number | null;
  spark: number[] | null;
}

const TH = "h-8 whitespace-nowrap px-3 text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint";
const TD = "whitespace-nowrap px-3 py-2.5 align-middle";

/** Positions at close — the design's simple nine-column ledger table. */
export function PositionsTable({ rows }: { rows: PositionRow[] }) {
  return (
    <div className="scroll-touch w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-rule-strong text-left">
            <th className={cn(TH, "pl-0 text-left")}>Ticker</th>
            <th className={cn(TH, "text-left")}>Sector</th>
            <th className={cn(TH, "text-right")}>Qty</th>
            <th className={cn(TH, "text-right")}>Avg cost</th>
            <th className={cn(TH, "text-right")}>Price</th>
            <th className={cn(TH, "text-right")}>Day</th>
            <th className={cn(TH, "text-right")}>Value</th>
            <th className={cn(TH, "text-right")}>Weight</th>
            <th className={cn(TH, "pr-0 text-right")}>7d</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker} className="border-b border-rule transition-colors last:border-0 hover:bg-surface-sunken/50">
              <td className={cn(TD, "pl-0")}>
                <Link href={`/stocks/${r.ticker}`} className="font-semibold text-text-strong hover:underline">{r.ticker}</Link>
                {r.name && <span className="block text-(length:--text-2xs) text-text-muted">{r.name}</span>}
              </td>
              <td className={TD}>
                <span title={r.sector ?? undefined} className="inline-flex items-center gap-[7px] text-xs text-text-muted">
                  <SectorDot sector={r.sector} />
                  {shortSector(r.sector)}
                </span>
              </td>
              <td className={cn(TD, "figure text-right")}>{formatNumber(r.qty, 0)}</td>
              <td className={cn(TD, "text-right", r.costUnknown ? "text-xs text-text-muted" : "figure")}>
                {r.costUnknown ? "Cost unknown" : r.avg !== null ? formatNumber(r.avg, 2) : "—"}
              </td>
              <td className={cn(TD, "figure text-right")}>{r.price !== null ? formatNumber(r.price, 2) : "—"}</td>
              <td className={cn(TD, "figure text-right font-semibold", (r.dayPct ?? 0) > 0 ? "text-up" : (r.dayPct ?? 0) < 0 ? "text-down" : "text-text-muted")}>
                {r.dayPct !== null ? `${r.dayPct < 0 ? "−" : "+"}${formatNumber(Math.abs(r.dayPct), 2)}%` : "—"}
              </td>
              <td className={cn(TD, "figure text-right")}>{r.value !== null ? formatNumber(r.value, 0) : "—"}</td>
              <td className={cn(TD, "figure text-right")}>{r.weight !== null ? `${formatNumber(r.weight, 1)}%` : "—"}</td>
              <td className={cn(TD, "pr-0 text-right")}>
                <span className="inline-block align-middle"><Sparkline data={r.spark} width={64} height={20} /></span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
