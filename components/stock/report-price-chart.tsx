"use client";

import { useMemo } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatNumber } from "@/lib/utils";
import type { CompanyReportPayload } from "@/lib/company/report";

export function ReportPriceChart({ payload }: { payload: CompanyReportPayload }) {
  const data = useMemo(() => payload.charts.price, [payload.charts.price]);
  const portfolio = payload.charts.portfolio;
  const avgCost = portfolio?.avgCost ?? null;
  const markers = portfolio?.markers ?? [];

  if (!data.length) {
    return <p className="text-xs text-muted-foreground">No price history available.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
          <YAxis tick={{ fontSize: 10 }} width={48} domain={["auto", "auto"]} />
          <Tooltip
            formatter={(v, name) => [typeof v === "number" ? formatNumber(v) : "—", name === "close" ? "Price" : "KSE-100 (indexed)"]}
            labelFormatter={(l) => l}
          />
          <Line type="monotone" dataKey="close" stroke="#0B5FFF" strokeWidth={2} dot={false} name="Price" />
          {data.some((d) => d.kse100Indexed != null) && (
            <Line type="monotone" dataKey="kse100Indexed" stroke="#00A676" strokeWidth={1.5} dot={false} name="KSE-100" />
          )}
          {avgCost != null && (
            <ReferenceLine y={avgCost} stroke="#D97706" strokeDasharray="4 4" label={{ value: "Avg cost", fontSize: 10 }} />
          )}
          {markers.map((m, i) => (
            <ReferenceLine
              key={`${m.date}-${i}`}
              x={m.date}
              stroke={m.type === "BUY" ? "#00A676" : "#D92D20"}
              strokeDasharray="2 2"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Green line: KSE-100 indexed to stock start · Orange dashed: average cost · Vertical: trades
      </p>
    </div>
  );
}
