"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  LineChart,
  Line,
  Area,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";
import { Check } from "lucide-react";
import { cn, formatNumber, formatSignedPct } from "@/lib/utils";
import {
  INK,
  EASE,
  DRAW_MS,
  useChartMotion,
  GlassTooltip,
  CURSOR,
  FadeDefs,
} from "@/components/chart-kit";

// Slightly larger and darker than the shared AXIS_TICK: this chart is the main
// visual on the Overview, so its axes get a small legibility bump.
const AXIS_TICK = { fontSize: 11.5, fill: "#475467" } as const;
// Overlay reference-line/label colour — darker than INK.neutral for readability.
const OVERLAY_LABEL = "#475467";

/** Toggle-chip styling so overlay controls read as interactive, not plain text. */
function chipClass(active: boolean): string {
  return cn(
    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors duration-200",
    active
      ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-white text-muted-foreground hover:bg-slate-50 hover:text-foreground"
  );
}
import type { Candle } from "@/lib/company/types";
import type { TechnicalSignals } from "@/lib/market/technicals";

const RANGES: { id: string; days: number | null; label: string }[] = [
  { id: "1M", days: 22, label: "1M" },
  { id: "3M", days: 66, label: "3M" },
  { id: "6M", days: 132, label: "6M" },
  { id: "YTD", days: null, label: "YTD" },
  { id: "1Y", days: 252, label: "1Y" },
  { id: "5Y", days: 1300, label: "5Y" },
];

function sma(values: number[], period: number, index: number): number | null {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) sum += values[i];
  return sum / period;
}

export interface BenchmarkPoint {
  date: string; // YYYY-MM-DD
  close: number;
}

export function StockPriceChart({
  candles,
  signals,
  benchmark,
  ticker,
  averageCostLine,
  showCurrentPriceLine = false,
}: {
  candles: Candle[];
  signals?: TechnicalSignals | null;
  benchmark?: BenchmarkPoint[];
  ticker?: string;
  averageCostLine?: number | null;
  showCurrentPriceLine?: boolean;
}) {
  const animate = useChartMotion();
  const [range, setRange] = useState("1Y");
  // Off by default: the first read is price + volume + average cost only.
  // Overlays are opt-in so the chart stays calm until the user asks for more.
  const [showMA, setShowMA] = useState(false);
  const [showStructure, setShowStructure] = useState(false);
  const [mode, setMode] = useState<"price" | "relative">("price");

  const hasBenchmark = !!benchmark && benchmark.length > 0;
  const relative = mode === "relative" && hasBenchmark;

  const data = useMemo(() => {
    const closes = candles.map((c) => c.close);
    const enriched = candles.map((c, i) => ({
      date: c.date,
      close: c.close,
      volume: c.volume,
      up: i === 0 ? true : c.close >= candles[i - 1].close,
      ma50: sma(closes, 50, i),
      ma200: sma(closes, 200, i),
    }));
    if (range === "YTD") {
      const year = new Date().getFullYear();
      const start = `${year}-01-01`;
      return enriched.filter((c) => c.date >= start);
    }
    const days = RANGES.find((r) => r.id === range)?.days ?? 252;
    return enriched.slice(-days);
  }, [candles, range]);

  // 52-week high/low for the long-term context lines.
  const yearBand = useMemo(() => {
    const yc = candles.slice(-252).map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0);
    if (!yc.length) return null;
    return { high: Math.max(...yc), low: Math.min(...yc) };
  }, [candles]);

  // Long-term structure overlays drawn only when there's a real accumulation
  // read and the user hasn't hidden them. Divergence pivots are filtered to the
  // visible range so we don't anchor a dot off-chart.
  const acc = signals?.accumulation ?? null;
  const firstDate = data[0]?.date ?? "";
  const divergencePivots = useMemo(() => {
    if (!signals?.divergences?.length) return [] as { date: string; price: number; kind: "bullish" | "bearish" }[];
    return signals.divergences.flatMap((d) =>
      [d.from, d.to]
        .filter((p) => p.date >= firstDate)
        .map((p) => ({ date: p.date, price: p.price, kind: d.kind }))
    );
  }, [signals, firstDate]);
  const hasStructure = showStructure && (!!acc?.zoneLow || !!yearBand || divergencePivots.length > 0);

  // Range performance readout shown next to the selector.
  const rangeChange = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0].close;
    const last = data[data.length - 1].close;
    return ((last - first) / first) * 100;
  }, [data]);

  // "Growth of 100" relative view: the stock and the KSE-100 both rebased to 100
  // at the first day of the visible range, so the lines compare growth, not
  // price level. The benchmark is forward-filled onto the stock's trading days
  // and the rebase anchor is the first day where both series have a value.
  const relativeData = useMemo(() => {
    if (!hasBenchmark) return [] as { date: string; stock: number; kse: number | null }[];
    const rangeDef = RANGES.find((r) => r.id === range);
    const slice =
      range === "YTD"
        ? candles.filter((c) => c.date >= `${new Date().getFullYear()}-01-01`)
        : candles.slice(-(rangeDef?.days ?? 252));
    const bench = benchmark!
      .filter((p) => Number.isFinite(p.close) && p.close > 0)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const out: { date: string; stock: number; kse: number | null }[] = [];
    let bi = 0;
    let lastBench: number | null = null;
    let baseStock: number | null = null;
    let baseBench: number | null = null;
    for (const c of slice) {
      if (!Number.isFinite(c.close) || c.close <= 0) continue;
      while (bi < bench.length && bench[bi].date <= c.date) {
        lastBench = bench[bi].close;
        bi++;
      }
      if (baseStock === null && lastBench !== null) {
        baseStock = c.close;
        baseBench = lastBench;
      }
      if (baseStock === null) continue;
      const stock = (c.close / baseStock) * 100;
      const kse = baseBench !== null && lastBench !== null ? (lastBench / baseBench) * 100 : null;
      out.push({ date: c.date, stock, kse });
    }
    return out;
  }, [hasBenchmark, benchmark, candles, range]);

  // Outperformance readout (percentage points) for the relative view.
  const relPerf = useMemo(() => {
    if (relativeData.length < 2) return null;
    const last = relativeData[relativeData.length - 1];
    if (last.kse === null) return null;
    return { stock: last.stock - 100, kse: last.kse - 100, diff: last.stock - last.kse };
  }, [relativeData]);

  if (candles.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center">
        <p className="text-xs text-muted-foreground">No price history available from the PSX portal.</p>
      </div>
    );
  }

  const trendUp = rangeChange === null || rangeChange >= 0;
  const lineColor = trendUp ? INK.up : INK.down;
  const currentPrice = data[data.length - 1]?.close ?? null;
  const tickEvery = Math.max(1, Math.floor((relative ? relativeData.length : data.length) / 6));
  // Long ranges: shorten the draw so 1,300-point sweeps still feel snappy.
  const drawMs = data.length > 400 ? 600 : DRAW_MS;

  return (
    <div className="chart-reveal">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                  range === r.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {!relative && rangeChange !== null && (
            <span
              className="flex items-baseline gap-1"
              title={`${range} return based on closing prices over the selected range. Price return only — excludes dividends.`}
            >
              <span
                className={cn(
                  "text-xs font-semibold tabular-nums transition-colors",
                  trendUp ? "text-emerald-600" : "text-red-600"
                )}
              >
                {formatSignedPct(rangeChange)}
              </span>
              <span className="text-[10px] font-normal text-muted-foreground">{range} price return</span>
            </span>
          )}
          {relative && relPerf !== null && (
            <span
              className={cn(
                "text-xs font-semibold tabular-nums transition-colors",
                relPerf.diff >= 0 ? "text-emerald-600" : "text-red-600"
              )}
              title="The stock's total return over this range minus the KSE-100's, in percentage points."
            >
              {formatSignedPct(relPerf.diff)} pp vs KSE-100
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {hasBenchmark && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Compare</span>
              <button
                onClick={() => setMode((m) => (m === "price" ? "relative" : "price"))}
                aria-pressed={relative}
                title="Compare this stock against the KSE-100, both rebased to 100 at the start of the range."
                className={chipClass(relative)}
              >
                {relative && <Check className="h-3 w-3" aria-hidden />} KSE-100
              </button>
            </div>
          )}
          {!relative && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Overlays</span>
              {signals && (
                <button
                  onClick={() => setShowStructure((v) => !v)}
                  aria-pressed={showStructure}
                  title="Multi-year price range, 52-week high/low, support and momentum-divergence pivots. Context only, not a trading signal."
                  className={chipClass(showStructure)}
                >
                  {showStructure && <Check className="h-3 w-3" aria-hidden />} Structure
                </button>
              )}
              <button
                onClick={() => setShowMA((v) => !v)}
                aria-pressed={showMA}
                title="50-day and 200-day moving averages."
                className={chipClass(showMA)}
              >
                {showMA && <Check className="h-3 w-3" aria-hidden />} MA 50/200
              </button>
            </div>
          )}
        </div>
      </div>

      {relative ? (
        <ResponsiveContainer key={`rel-${range}`} width="100%" height={330}>
          <LineChart data={relativeData} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              interval={tickEvery}
              tickFormatter={(d: string) => d?.slice(2)}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={AXIS_TICK}
              domain={["auto", "auto"]}
              width={48}
              tickFormatter={(v: number) => v.toFixed(0)}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={<GlassTooltip format={(v) => formatNumber(Number(v))} />}
              cursor={CURSOR}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="plainline" iconSize={14} />
            {/* Both paths start at 100, so this baseline marks break-even. */}
            <ReferenceLine y={100} stroke={INK.neutral} strokeDasharray="2 3" strokeOpacity={0.5} />
            <Line
              type="monotone"
              dataKey="kse"
              name="KSE-100"
              stroke={INK.neutral}
              strokeWidth={1.8}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
              isAnimationActive={animate}
              animationDuration={drawMs}
              animationEasing={EASE}
            />
            <Line
              type="monotone"
              dataKey="stock"
              name={ticker ?? "This stock"}
              stroke={INK.line}
              strokeWidth={2.4}
              dot={false}
              isAnimationActive={animate}
              animationDuration={drawMs}
              animationBegin={animate ? 120 : 0}
              animationEasing={EASE}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
      <>
      {/* key={range} re-triggers the draw sweep on every range switch */}
      <ResponsiveContainer key={range} width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
          <FadeDefs defs={[{ id: `priceFade-${trendUp ? "up" : "down"}`, color: lineColor, from: 0.2, to: 0 }]} />
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          {/* Long-term accumulation band — drawn first so price sits on top of it. */}
          {hasStructure && acc?.zoneLow != null && acc.zoneHigh != null && (
            <ReferenceArea
              yAxisId="price"
              y1={acc.zoneLow}
              y2={acc.zoneHigh}
              ifOverflow="hidden"
              fill={INK.line}
              fillOpacity={0.07}
              stroke={INK.lineSoft}
              strokeOpacity={0.35}
              strokeDasharray="2 3"
              label={{ value: "Multi-year price range", position: "insideTopLeft", fontSize: 10.5, fill: INK.line, opacity: 0.8 }}
            />
          )}
          <XAxis
            dataKey="date"
            tick={AXIS_TICK}
            interval={tickEvery}
            tickFormatter={(d: string) => d?.slice(2)}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="price"
            tick={AXIS_TICK}
            domain={["auto", "auto"]}
            width={48}
            tickFormatter={(v: number) => v.toFixed(0)}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={
              <GlassTooltip
                format={(v, key) =>
                  key === "volume" ? Number(v).toLocaleString("en-PK") : formatNumber(Number(v))
                }
              />
            }
            cursor={CURSOR}
          />
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="close"
            name="Close"
            stroke={lineColor}
            strokeWidth={2}
            fill={`url(#priceFade-${trendUp ? "up" : "down"})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fbfbf9", fill: lineColor }}
            isAnimationActive={animate}
            animationDuration={drawMs}
            animationEasing={EASE}
          />
          {showMA && (
            <>
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="ma50"
                name="MA50"
                stroke={INK.amber}
                strokeWidth={1.3}
                dot={false}
                connectNulls
                isAnimationActive={animate}
                animationDuration={drawMs}
                animationBegin={animate ? 150 : 0}
                animationEasing={EASE}
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="ma200"
                name="MA200"
                stroke={INK.terracotta}
                strokeWidth={1.3}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                isAnimationActive={animate}
                animationDuration={drawMs}
                animationBegin={animate ? 250 : 0}
                animationEasing={EASE}
              />
            </>
          )}
          {hasStructure && yearBand && (
            <>
              <ReferenceLine
                yAxisId="price"
                y={yearBand.high}
                ifOverflow="hidden"
                stroke={INK.neutral}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{ value: "52w high", position: "right", fontSize: 10.5, fill: OVERLAY_LABEL }}
              />
              <ReferenceLine
                yAxisId="price"
                y={yearBand.low}
                ifOverflow="hidden"
                stroke={INK.neutral}
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                label={{ value: "52w low", position: "right", fontSize: 10.5, fill: OVERLAY_LABEL }}
              />
            </>
          )}
          {showCurrentPriceLine && currentPrice !== null && (
            <ReferenceLine
              yAxisId="price"
              y={currentPrice}
              ifOverflow="hidden"
              stroke={lineColor}
              strokeDasharray="2 3"
              strokeOpacity={0.5}
              label={{ value: "Current", position: "right", fontSize: 10.5, fill: lineColor }}
            />
          )}
          {averageCostLine !== null && averageCostLine !== undefined && averageCostLine > 0 && (
            <ReferenceLine
              yAxisId="price"
              y={averageCostLine}
              ifOverflow="extendDomain"
              stroke={INK.amber}
              strokeDasharray="6 4"
              strokeOpacity={0.9}
              label={{ value: "Avg cost", position: "left", fontSize: 10.5, fill: INK.amber }}
            />
          )}
          {hasStructure && acc?.majorSupport != null && (
            <ReferenceLine
              yAxisId="price"
              y={acc.majorSupport}
              ifOverflow="hidden"
              stroke={INK.up}
              strokeDasharray="5 4"
              strokeOpacity={0.55}
              label={{ value: "Support", position: "left", fontSize: 10.5, fill: INK.up }}
            />
          )}
          {hasStructure && divergencePivots.map((p, i) => (
            <ReferenceDot
              key={`${p.date}-${i}`}
              yAxisId="price"
              x={p.date}
              y={p.price}
              r={4}
              ifOverflow="hidden"
              fill={p.kind === "bullish" ? INK.up : INK.down}
              stroke="#fbfbf9"
              strokeWidth={1.5}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      <ResponsiveContainer key={`vol-${range}`} width="100%" height={70}>
        <ComposedChart data={data} margin={{ top: 2, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[0, "auto"]} width={48} />
          <Tooltip
            content={
              <GlassTooltip format={(v) => Number(v).toLocaleString("en-PK")} />
            }
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
          />
          <Bar
            dataKey="volume"
            name="Volume"
            radius={[2, 2, 0, 0]}
            isAnimationActive={animate}
            animationDuration={drawMs}
            animationBegin={animate ? 200 : 0}
            animationEasing={EASE}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.up ? INK.upSoft : INK.downSoft} opacity={0.55} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      </>
      )}
    </div>
  );
}
