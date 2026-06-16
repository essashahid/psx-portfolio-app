"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TICK, ChartEmpty, DRAW_MS, EASE, INK, useChartMotion } from "@/components/chart-kit";
import { fmtPct } from "@/lib/market/format";
import type { BucketRow, EnrichedTradeSetup, PortfolioStrategyRow } from "@/lib/market/bulls-bears";
import type { ScoredStock } from "@/lib/market/score";
import { BUCKET_META } from "@/lib/market/sectors";

const VERDICT_COLORS: Record<PortfolioStrategyRow["verdict"], string> = {
  setup_add: INK.up,
  add_candidate: INK.line,
  hold_watch: INK.neutral,
  risk_review: INK.down,
};

const SETUP_STATUS_COLORS: Record<EnrichedTradeSetup["status"], string> = {
  in_entry: INK.up,
  below_entry: INK.amber,
  above_entry: INK.line,
  extended: INK.terracotta,
  invalidated: INK.down,
  watch: INK.neutral,
};

interface TooltipRow {
  payload?: unknown;
}

function payloadOf<T>(payload: unknown): T | null {
  const rows = payload as readonly TooltipRow[] | undefined;
  return (rows?.[0]?.payload as T | undefined) ?? null;
}

export function RegimeRotationChart({ buckets }: { buckets: BucketRow[] }) {
  const animate = useChartMotion();
  const data = useMemo(() => {
    return buckets
      .filter((b) => b.avgReturn != null)
      .map((b) => ({
        bucket: b.bucket,
        label: BUCKET_META[b.bucket].label,
        value: Number(b.avgReturn ?? 0),
        breadth: b.advancers + b.decliners > 0 ? (b.advancers / (b.advancers + b.decliners)) * 100 : null,
        stockCount: b.stockCount,
        topSector: b.topSector,
        topSectorReturn: b.topSectorReturn,
      }))
      .sort((a, b) => b.value - a.value);
  }, [buckets]);

  if (!data.length) return <ChartEmpty note="No live sector-rotation data yet." height={220} />;

  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={Math.max(220, data.length * 42)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 18, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={AXIS_TICK} width={128} axisLine={false} tickLine={false} />
          <ReferenceLine x={0} stroke={INK.neutral} strokeWidth={1} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
            content={({ active, payload }) => {
              const row = active ? payloadOf<(typeof data)[number]>(payload) : null;
              if (!row) return null;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{row.label}</p>
                  <div className="space-y-1 text-[11px]">
                    <Line label="Avg return" value={fmtPct(row.value)} />
                    <Line label="Breadth" value={row.breadth != null ? `${row.breadth.toFixed(0)}% advancers` : "-"} />
                    <Line label="Stocks" value={String(row.stockCount)} />
                    <Line label="Top sector" value={row.topSector ? `${row.topSector} ${fmtPct(row.topSectorReturn)}` : "-"} />
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={animate} animationDuration={DRAW_MS} animationEasing={EASE}>
            {data.map((row) => <Cell key={row.bucket} fill={row.value >= 0 ? INK.up : INK.down} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScoreMomentumMap({ stocks, owned }: { stocks: ScoredStock[]; owned: string[] }) {
  const animate = useChartMotion();
  const ownedSet = useMemo(() => new Set(owned), [owned]);
  const data = useMemo(() => {
    return stocks
      .filter((s) => s.subScores.momentum != null)
      .slice(0, 80)
      .map((s) => ({
        ticker: s.ticker,
        score: s.score,
        momentum: s.subScores.momentum ?? 0,
        quality: s.subScores.quality,
        growth: s.subScores.growth,
        bucket: s.bucket,
        rank: s.rank,
        owned: ownedSet.has(s.ticker),
      }));
  }, [stocks, ownedSet]);

  if (!data.length) return <ChartEmpty note="Needs scored stocks with momentum data." height={260} />;

  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 16, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} />
          <XAxis type="number" dataKey="score" name="Score" domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis type="number" dataKey="momentum" name="Momentum" domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} width={34} />
          <ReferenceLine x={60} stroke={INK.neutral} strokeDasharray="4 4" />
          <ReferenceLine y={60} stroke={INK.neutral} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ stroke: INK.neutral, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const row = active ? payloadOf<(typeof data)[number]>(payload) : null;
              if (!row) return null;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{row.ticker}{row.owned ? " - owned" : ""}</p>
                  <div className="space-y-1 text-[11px]">
                    <Line label="Rank / score" value={`#${row.rank} / ${row.score.toFixed(0)}`} />
                    <Line label="Momentum" value={row.momentum.toFixed(0)} />
                    <Line label="Quality" value={row.quality != null ? row.quality.toFixed(0) : "-"} />
                    <Line label="Bucket" value={BUCKET_META[row.bucket].label} />
                  </div>
                </div>
              );
            }}
          />
          <Scatter data={data} isAnimationActive={animate} animationDuration={DRAW_MS} animationEasing={EASE}>
            {data.map((row) => (
              <Cell key={row.ticker} fill={row.owned ? INK.up : row.score >= 70 && row.momentum >= 60 ? INK.line : INK.neutral} opacity={row.owned ? 1 : 0.72} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SetupRiskRewardChart({ setups }: { setups: EnrichedTradeSetup[] }) {
  const animate = useChartMotion();
  const data = useMemo(() => {
    return setups
      .filter((s) => s.riskPct != null || s.rewardPct != null)
      .map((s) => ({
        ticker: s.setup.ticker,
        risk: s.riskPct != null ? -Math.abs(s.riskPct) : 0,
        reward: s.rewardPct ?? 0,
        status: s.status,
        entry: s.setup.entry,
        stop: s.setup.stop,
        target: s.setup.targets[0]?.price,
        caveat: s.setup.caveat,
      }));
  }, [setups]);

  if (!data.length) return <ChartEmpty note="No numeric setup levels available." height={220} />;

  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 14, bottom: 8, left: 6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="ticker" tick={AXIS_TICK} width={54} axisLine={false} tickLine={false} />
          <ReferenceLine x={0} stroke={INK.neutral} strokeWidth={1} />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
            content={({ active, payload }) => {
              const row = active ? payloadOf<(typeof data)[number]>(payload) : null;
              if (!row) return null;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{row.ticker}</p>
                  <div className="space-y-1 text-[11px]">
                    <Line label="Entry" value={row.entry} />
                    <Line label="Stop" value={row.stop} />
                    <Line label="Target 1" value={row.target != null ? String(row.target) : "-"} />
                    <Line label="Risk / reward" value={`${Math.abs(row.risk).toFixed(1)}% / ${row.reward.toFixed(1)}%`} />
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="risk" name="Risk to stop" radius={[4, 0, 0, 4]} fill={INK.down} isAnimationActive={animate} animationDuration={DRAW_MS} animationEasing={EASE} />
          <Bar dataKey="reward" name="Reward to T1" radius={[0, 4, 4, 0]} isAnimationActive={animate} animationDuration={DRAW_MS} animationEasing={EASE}>
            {data.map((row) => <Cell key={row.ticker} fill={SETUP_STATUS_COLORS[row.status]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PortfolioStrategyChart({ rows }: { rows: PortfolioStrategyRow[] }) {
  const animate = useChartMotion();
  const data = useMemo(() => {
    return rows
      .filter((row) => row.score != null)
      .slice(0, 12)
      .map((row) => ({
        ticker: row.ticker,
        score: row.score ?? 0,
        verdict: row.verdict,
        verdictLabel: row.verdictLabel,
        rank: row.rank,
        best: row.bestSubScore,
        weakest: row.weakestSubScore,
      }));
  }, [rows]);

  if (!data.length) return <ChartEmpty note="Your holdings need score data before they can be charted." height={240} />;

  return (
    <div className="chart-reveal">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 6, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={INK.grid} vertical={false} />
          <XAxis dataKey="ticker" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} width={34} />
          <ReferenceLine y={60} stroke={INK.neutral} strokeDasharray="4 4" />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.035)" }}
            content={({ active, payload }) => {
              const row = active ? payloadOf<(typeof data)[number]>(payload) : null;
              if (!row) return null;
              return (
                <div className="chart-tooltip">
                  <p className="chart-tooltip-label">{row.ticker}</p>
                  <div className="space-y-1 text-[11px]">
                    <Line label="Score / rank" value={`${row.score.toFixed(0)} / #${row.rank ?? "-"}`} />
                    <Line label="Verdict" value={row.verdictLabel} />
                    <Line label="Best" value={row.best ?? "-"} />
                    <Line label="Weakest" value={row.weakest ?? "-"} />
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="score" radius={[5, 5, 1, 1]} maxBarSize={42} isAnimationActive={animate} animationDuration={DRAW_MS} animationEasing={EASE}>
            {data.map((row) => <Cell key={row.ticker} fill={VERDICT_COLORS[row.verdict]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold tabular-nums">{value}</span>
    </div>
  );
}
