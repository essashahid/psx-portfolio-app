"use client";

import { useState } from "react";
import { cn } from "@/lib/shared/format";
import { METRICS, METRIC_PRIORITY, MIN_MEDIAN_PEERS, type FundamentalsData, type MetricDef, type MetricKey } from "@/lib/company/fundamentals";

/**
 * The Fundamentals centrepiece: six metrics as small multiples, one selected at
 * a time to open the years and the sector ranking beneath.
 *
 * The hairlines between cells are a 1px grid gap over a ruled background, not
 * borders, so no cell owns an edge and the lines stay even.
 *
 * Every cell draws only the years actually filed. Most companies have three or
 * four; some have two, and the balance-sheet metrics are often absent
 * altogether. A metric with nothing behind it says so rather than showing an
 * empty frame, and a single filed year draws a dot instead of pretending to a
 * trend.
 */
/**
 * Choose which metrics the grid shows.
 *
 * Six fixed cells with three reading "not filed" is a wall of absence where the
 * design promised a quick read, so the grid fills from a fixed priority list
 * with what the company has actually filed, backed by derived metrics, and
 * shows at most two absent cells. If fewer than four metrics have anything, it
 * drops to a 2x2 rather than padding out to six.
 */
function chooseMetrics(data: FundamentalsData): { shown: MetricDef[]; columns: 2 | 3 } {
  const byKey = new Map(METRICS.map((m) => [m.key, m]));
  const ordered = METRIC_PRIORITY.map((k) => byKey.get(k)!).filter(Boolean);

  const present = ordered.filter((m) => data.series[m.key].points.length > 0);
  const absent = ordered.filter((m) => data.series[m.key].points.length === 0);

  const target = present.length >= 4 ? 6 : 4;
  const columns: 2 | 3 = target === 6 ? 3 : 2;
  const shown = present.slice(0, target);
  const gaps = Math.min(2, target - shown.length);
  return { shown: [...shown, ...absent.slice(0, gaps)], columns };
}

export function FundamentalsGrid({ data, hue }: { data: FundamentalsData; hue: string }) {
  const { shown, columns } = chooseMetrics(data);
  const withData = shown.filter((m) => data.series[m.key].points.length > 0);
  const [selected, setSelected] = useState<MetricKey>(withData[0]?.key ?? shown[0]?.key ?? "revenue");

  const def = METRICS.find((m) => m.key === selected)!;
  const series = data.series[selected];

  return (
    <div>
      <div className={cn("grid gap-px bg-rule sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
        {shown.map((m) => (
          <MetricCell
            key={m.key}
            def={m}
            data={data}
            hue={hue}
            selected={m.key === selected}
            onSelect={() => data.series[m.key].points.length > 0 && setSelected(m.key)}
          />
        ))}
      </div>

      {series.points.length > 0 && (
        <div className="mt-8 grid gap-10 border-t border-rule pt-7 lg:grid-cols-2">
          <div>
            <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
              {def.label} by filed year
            </p>
            <div className="mt-3.5">
              {series.points.map((p, i) => {
                const prev = i > 0 ? series.points[i - 1].value : null;
                const chg = prev !== null && prev !== 0 ? ((p.value - prev) / Math.abs(prev)) * 100 : null;
                const good = chg === null ? null : def.lowerIsBetter ? chg < 0 : chg > 0;
                return (
                  <div key={p.year} className="flex items-baseline justify-between gap-6 border-b border-rule py-2.5">
                    <span className="figure text-sm text-text-muted">FY{p.year}</span>
                    <span className="flex items-baseline gap-4">
                      <span className="figure text-sm font-semibold text-text-strong">{def.format(p.value)}</span>
                      <span
                        className={cn(
                          "figure w-20 text-right text-(length:--text-2xs) font-semibold",
                          good === null && "text-text-faint",
                          good === true && "text-up",
                          good === false && "text-down"
                        )}
                      >
                        {chg === null ? "first year" : `${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(1)}%`}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3.5 max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-muted">
              {def.note}
            </p>
          </div>

          <PeerRanking data={data} def={def} hue={hue} />
        </div>
      )}
    </div>
  );
}

function MetricCell({
  def,
  data,
  hue,
  selected,
  onSelect,
}: {
  def: MetricDef;
  data: FundamentalsData;
  hue: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const s = data.series[def.key];
  const pts = s.points;
  const has = pts.length > 0;
  const latest = has ? pts[pts.length - 1] : null;
  const prior = pts.length > 1 ? pts[pts.length - 2] : null;
  const chg = latest && prior && prior.value !== 0 ? ((latest.value - prior.value) / Math.abs(prior.value)) * 100 : null;
  // Direction is judged per metric: a falling debt-to-equity is the good way.
  const good = chg === null ? null : def.lowerIsBetter ? chg < 0 : chg > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!has}
      title={has ? `Read ${def.label} year by year` : `${def.label} has not been filed`}
      className={cn(
        "block w-full border-l-2 bg-surface-page px-5 pb-4 pt-4 text-left transition-colors",
        has ? "cursor-pointer hover:bg-surface-sunken" : "cursor-default",
        !selected && "border-l-transparent"
      )}
      style={
        selected
          ? { borderLeftColor: hue, background: `color-mix(in oklab, ${hue} 10%, var(--surface-page))` }
          : undefined
      }
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
          {def.label}
        </span>
        {chg !== null && (
          <span className={cn("figure text-(length:--text-2xs) font-semibold", good ? "text-up" : "text-down")}>
            {chg >= 0 ? "+" : "−"}{Math.abs(chg).toFixed(1)}% on FY{prior!.year}
          </span>
        )}
      </span>

      {has ? (
        <>
          <span className="figure mt-2 block text-(length:--text-h1) font-semibold leading-none text-text-strong">
            {def.format(latest!.value)}
          </span>
          <span className="mt-1 block text-(length:--text-2xs) text-text-faint">{def.unit}</span>
          {pts.length > 1 ? (
            <Spark points={pts} median={s.sectorMedian} hue={hue} />
          ) : (
            // A single filed year is a point, not a trend. It keeps the frame
            // height so the grid stays even, but draws no axis and no median.
            <span className="mt-3.5 flex h-[4.125rem] items-center gap-2.5">
              <span className="block h-1.5 w-1.5 rounded-full" style={{ background: hue }} />
              <span className="figure text-(length:--text-2xs) text-text-faint">
                FY{latest!.year} only — one filed year cannot show a trend
              </span>
            </span>
          )}
          <span className="mt-2.5 flex items-baseline justify-between gap-3">
            <span className="figure text-(length:--text-2xs) text-text-faint">
              {pts.length > 1
                ? `${pts.length} filed years ${def.format(Math.min(...pts.map((p) => p.value)))}–${def.format(Math.max(...pts.map((p) => p.value)))}`
                : `one filed year, FY${latest!.year}`}
            </span>
            <span className="figure text-(length:--text-2xs) text-text-muted">
              {s.sectorMedian !== null
                ? `median ${def.format(s.sectorMedian)}`
                : s.peerCount > 0
                  ? `only ${s.peerCount} peer${s.peerCount === 1 ? "" : "s"} filed`
                  : "no sector median"}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="mt-2 block text-(length:--text-h1) font-normal leading-none text-text-faint">Not filed</span>
          <span className="mt-1 block text-(length:--text-2xs) text-text-faint">{def.unit}</span>
          <span className="mt-3.5 flex h-[4.125rem] items-start">
            <span className="max-w-(--measure) text-(length:--text-2xs) leading-relaxed text-text-faint">
              No filed accounts carry the figures this needs. It appears once they are extracted.
            </span>
          </span>
        </>
      )}
    </button>
  );
}

/**
 * The five-year line over the company's own range, with the sector median as a
 * dashed rule. The band is the company's own min to max, so the line always
 * spans the frame and the median rule shows where the sector sits against it.
 */
function Spark({
  points,
  median,
  hue,
}: {
  points: { year: number; value: number }[];
  median: number | null;
  hue: string;
}) {
  const W = 240;
  const H = 66;
  const PAD = 10;

  const values = points.map((p) => p.value);
  // The median only shares the scale when it is in the same neighbourhood; a
  // wildly different peer figure would otherwise flatten the company's own line.
  const lo = Math.min(...values, median ?? Infinity);
  const hi = Math.max(...values, median ?? -Infinity);
  const span = hi - lo || Math.abs(hi) || 1;
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      className="mt-3.5 block overflow-visible"
      aria-hidden="true"
    >
      <rect x="0" y={y(hi)} width={W} height={Math.max(1, y(lo) - y(hi))} fill={hue} fillOpacity="0.1" />
      {median !== null && (
        <line x1="0" y1={y(median)} x2={W} y2={y(median)} stroke="var(--ink-3)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      )}
      {points.length > 1 && (
        <path
          d={`M${points.map((p, i) => `${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" L")}`}
          fill="none"
          stroke={hue}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle cx={x(points.length - 1)} cy={y(values[values.length - 1])} r="3" fill={hue} />
    </svg>
  );
}

/** Sector peers on the selected metric, the company drawn in its own hue. */
function PeerRanking({ data, def, hue }: { data: FundamentalsData; def: MetricDef; hue: string }) {
  const rows = data.ranking[def.key];
  if (rows.length < 2) {
    return (
      <div>
        <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
          Against the sector
        </p>
        <p className="mt-3.5 max-w-(--measure) text-sm leading-relaxed text-text-muted">
          No other company in {data.sector ?? "this sector"} has filed this figure, so there is nothing to rank against.
        </p>
      </div>
    );
  }

  const self = rows.findIndex((r) => r.isSelf);
  const values = rows.map((r) => r.value);
  const lo = Math.min(...values, 0);
  const hi = Math.max(...values, 0);
  const width = (v: number) => (hi - lo === 0 ? 0 : ((v - lo) / (hi - lo)) * 100);
  const shown = rows.slice(0, 12);

  return (
    <div>
      <p className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
        Against the sector
      </p>
      <p className="figure mt-1.5 text-sm text-text-muted">
        {self >= 0 ? `Ranked ${self + 1} of ${rows.length}` : `${rows.length} companies`} on latest filed {def.label.toLowerCase()}
      </p>
      <div className="mt-3.5">
        {shown.map((r) => (
          <div key={r.ticker} className="flex items-center gap-3 py-1">
            <span className={cn("figure w-16 shrink-0 text-(length:--text-2xs)", r.isSelf ? "font-semibold text-text-strong" : "text-text-muted")}>
              {r.ticker}
            </span>
            <span className="h-2 min-w-px flex-1 bg-surface-inset">
              <span
                className="block h-full"
                style={{ width: `${Math.max(1, width(r.value))}%`, background: r.isSelf ? hue : "var(--ink-4)" }}
              />
            </span>
            <span className={cn("figure w-20 shrink-0 text-right text-(length:--text-2xs)", r.isSelf ? "font-semibold text-text-strong" : "text-text-muted")}>
              {def.format(r.value)}
            </span>
          </div>
        ))}
      </div>
      {rows.length > shown.length && (
        <p className="figure mt-2.5 text-(length:--text-2xs) text-text-faint">
          Showing the top {shown.length} of {rows.length}.
        </p>
      )}
    </div>
  );
}
