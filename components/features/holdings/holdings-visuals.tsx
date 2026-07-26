import { formatNumber } from "@/lib/shared/format";
import { sectorColor, shortSector } from "@/lib/shared/sector-colors";

export interface SectorSlice {
  sector: string;
  value: number;
}

/**
 * Stacked sector-weight bar with its legend. The hero band's one visual: a
 * single ruled strip that shows how the book divides before any table is read.
 */
export function SectorWeightBar({ slices, total }: { slices: SectorSlice[]; total: number }) {
  if (slices.length === 0 || total <= 0) return null;
  const ordered = [...slices].sort((a, b) => b.value - a.value);

  return (
    <div className="mt-6">
      <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
        Weight by sector
      </p>
      <div className="mt-2 flex h-3.5 gap-0.5">
        {ordered.map((s) => {
          const pct = (s.value / total) * 100;
          return (
            <span
              key={s.sector}
              title={`${s.sector} · ${formatNumber(pct, 1)}%`}
              style={{ width: `${pct}%`, background: sectorColor(s.sector) }}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
        {ordered.map((s) => (
          <span key={s.sector} className="inline-flex items-baseline gap-[7px] text-xs text-text-muted">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: sectorColor(s.sector) }} />
            <span>{shortSector(s.sector)}</span>
            <span className="figure font-semibold text-text-strong">
              {formatNumber((s.value / total) * 100, 1)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Sector treemap. Slices under 6% of the book collapse into a single "Other"
 * tile so the smallest positions never render as unreadable slivers; rows are
 * split so roughly the first 60% of value occupies the top band.
 */
export function SectorTreemap({ slices, total }: { slices: SectorSlice[]; total: number }) {
  if (slices.length === 0 || total <= 0) return null;

  const ordered = [...slices].sort((a, b) => b.value - a.value);
  const big = ordered.filter((s) => s.value / total >= 0.06);
  const small = ordered.filter((s) => s.value / total < 0.06);
  const list: (SectorSlice & { other?: boolean })[] =
    small.length > 1
      ? [
          ...big,
          {
            sector: small.map((s) => shortSector(s.sector)).join(", "),
            value: small.reduce((n, s) => n + s.value, 0),
            other: true,
          },
        ]
      : ordered;

  const rows: (SectorSlice & { other?: boolean })[][] = [[], []];
  let acc = 0;
  for (const item of list) {
    rows[acc / total < 0.6 ? 0 : 1].push(item);
    acc += item.value;
  }

  return (
    <div className="mt-3.5 flex h-53 flex-col gap-[3px]">
      {rows
        .filter((r) => r.length > 0)
        .map((row, i) => {
          const sum = row.reduce((n, s) => n + s.value, 0) || 1;
          return (
            <span key={i} className="flex gap-[3px]" style={{ height: `${(sum / total) * 100}%` }}>
              {row.map((tile) => {
                const share = (tile.value / total) * 100;
                return (
                  <span
                    key={tile.sector}
                    title={`${tile.other ? `Other · ${tile.sector}` : tile.sector} · ${formatNumber(share, 1)}%`}
                    className="flex min-w-0 flex-col justify-between overflow-hidden px-2.5 py-2.5"
                    style={{
                      width: `${(tile.value / sum) * 100}%`,
                      background: tile.other
                        ? "var(--flat-2)"
                        : `color-mix(in oklab, ${sectorColor(tile.sector)} 88%, var(--ink-1))`,
                    }}
                  >
                    <span
                      className="truncate font-semibold leading-tight text-white"
                      style={{ fontSize: share > 12 ? "var(--text-sm)" : "var(--text-2xs)" }}
                    >
                      {tile.other ? "Other" : shortSector(tile.sector)}
                    </span>
                    <span
                      className="figure font-semibold leading-none text-white"
                      style={{ fontSize: share > 12 ? "var(--text-h3)" : "var(--text-xs)" }}
                    >
                      {formatNumber(share, 1)}%
                    </span>
                  </span>
                );
              })}
            </span>
          );
        })}
    </div>
  );
}

export interface BelowCostRow {
  ticker: string;
  last: number;
  avg: number;
}

/**
 * Cost against last price. One track per underwater position: the grey dot is
 * average cost, the red dot the last price, and the gap between them is the
 * loss. Scaled against the worst position so the shape is comparable.
 */
export function BelowCostPlot({ rows }: { rows: BelowCostRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-3.5 text-sm text-text-muted">No positions sit below cost.</p>;
  }
  const maxGap = Math.max(...rows.map((r) => 1 - r.last / r.avg)) || 1;

  return (
    <>
      <div className="ledger mt-1.5">
        {rows.map((r) => {
          const gap = 1 - r.last / r.avg;
          const lastPos = (1 - (gap / maxGap) * 0.78) * 100 - 6;
          return (
            <div
              key={r.ticker}
              className="ledger-row grid items-center gap-3"
              style={{ gridTemplateColumns: "3.875rem 3.875rem 1fr 3.875rem 4rem" }}
            >
              <span className="text-sm font-semibold text-text-strong">{r.ticker}</span>
              <span className="figure text-right text-xs text-down">{formatNumber(r.last, 2)}</span>
              <span className="relative block h-[11px]">
                <span className="absolute inset-x-0 top-[5px] h-px bg-rule" />
                <span
                  className="absolute top-1 h-[3px] bg-[var(--down-3)]"
                  style={{ left: `${lastPos}%`, right: "5px" }}
                />
                <span className="absolute right-0 top-0 h-[11px] w-[11px] rounded-full bg-[var(--flat-2)]" />
                <span
                  className="absolute top-0 h-[11px] w-[11px] rounded-full bg-[var(--down-2)]"
                  style={{ left: `${lastPos}%` }}
                />
              </span>
              <span className="figure text-right text-xs text-text-muted">{formatNumber(r.avg, 2)}</span>
              <span className="figure text-right text-sm font-semibold text-down">
                {formatNumber((r.last / r.avg - 1) * 100, 2)}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3.5 text-(length:--text-2xs) text-text-faint">
        Left figure is the last price, right is average cost.
      </p>
    </>
  );
}
