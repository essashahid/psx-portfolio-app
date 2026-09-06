"use client";

import { useMemo } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatNumber } from "@/lib/shared/format";
import type { CompanyReportPayload } from "@/lib/company/report";
import { adjustForCorporateActions, detectCorporateActionBreaks } from "@psx/shared/market/adjust";

export function ReportPriceChart({ payload }: { payload: CompanyReportPayload }) {
  // The report series is stored raw. Back-adjust it here for bonus and split
  // events, and rescale the KSE-100 overlay by the same factor: it is indexed
  // to the stock's first close, which the adjustment has just restated.
  const { data, breaks } = useMemo(() => {
    const raw = payload.charts.price;
    const breaks = detectCorporateActionBreaks(raw).length;
    if (breaks === 0) return { data: raw, breaks };
    const adjusted = adjustForCorporateActions(raw);
    const factor = raw[0]?.close ? adjusted[0].close / raw[0].close : 1;
    return {
      data: adjusted.map((p) => ({
        ...p,
        kse100Indexed: p.kse100Indexed == null ? p.kse100Indexed : p.kse100Indexed * factor,
      })),
      breaks,
    };
  }, [payload.charts.price]);
  const portfolio = payload.charts.portfolio;
  const avgCost = portfolio?.avgCost ?? null;
  const markers = portfolio?.markers ?? [];

  if (!data.length) {
    return <p className="text-xs text-text-muted">No price history available.</p>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-rule/50" />
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
      <p className="mt-1 text-[10px] text-text-muted">
        Green line: KSE-100 indexed to stock start · Orange dashed: average cost · Vertical: trades
        {breaks > 0 ? " · Adjusted for bonus and split events" : ""}
      </p>
    </div>
  );
}
