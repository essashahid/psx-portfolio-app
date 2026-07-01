"use client";

import { useEffect, useRef, useState } from "react";
import { INK, SERIES_COLORS } from "@/components/chart-kit";

/**
 * Renders a model-authored Vega-Lite spec. This is the general visualization
 * grammar: the Copilot composes any chart it needs and we draw it, themed to the
 * house palette, instead of being limited to a fixed menu of typed artifacts.
 *
 * Loaded via next/dynamic so the ~1MB Vega runtime is a separate chunk fetched
 * only when an answer actually contains a vega-lite artifact.
 *
 * Safety: the spec is declarative (no arbitrary JS), and we additionally refuse
 * any spec that pulls data from an external URL, so a chart can never be used to
 * fetch or exfiltrate. All data must be embedded inline in data.values.
 */

function usesExternalData(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(usesExternalData);
  const obj = node as Record<string, unknown>;
  if (typeof obj.url === "string") return true;
  return Object.values(obj).some(usesExternalData);
}

// House theme so model charts match the rest of the app's editorial palette.
const VEGA_CONFIG: Record<string, unknown> = {
  background: "transparent",
  font: "inherit",
  view: { stroke: "transparent" },
  axis: {
    labelColor: INK.neutral, titleColor: INK.neutral,
    gridColor: INK.grid, domainColor: INK.grid, tickColor: INK.grid,
    labelFontSize: 10, titleFontSize: 11, labelFont: "inherit", titleFont: "inherit",
    gridDash: [3, 0],
  },
  legend: { labelColor: INK.neutral, titleColor: INK.neutral, labelFontSize: 10, titleFontSize: 11, symbolType: "circle" },
  title: { color: "#3a3a34", fontSize: 12, font: "inherit", fontWeight: 600, anchor: "start" },
  range: { category: SERIES_COLORS, ramp: [INK.lineSoft, INK.line], heatmap: [INK.upSoft, INK.amber, INK.down] },
  mark: { color: INK.line },
  line: { color: INK.line, strokeWidth: 1.75 },
  area: { color: INK.line, opacity: 0.18, line: { color: INK.line, strokeWidth: 1.75 } },
  bar: { fill: INK.line, cornerRadiusEnd: 3 },
  point: { fill: INK.line, filled: true },
  arc: { stroke: "transparent" },
  rule: { color: INK.neutral },
};

export default function VegaLiteChart({ spec, fallback }: { spec: Record<string, unknown>; fallback?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Refuse external-data specs up front (during render, not in the effect).
  const blocked = usesExternalData(spec.data);

  useEffect(() => {
    if (blocked) return;
    let finalize: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const vegaEmbed = (await import("vega-embed")).default;
        if (cancelled || !ref.current) return;
        const userConfig = spec.config && typeof spec.config === "object" ? (spec.config as Record<string, unknown>) : {};
        const themed: Record<string, unknown> = {
          ...spec,
          width: "container",
          height: typeof spec.height === "number" ? spec.height : 260,
          autosize: { type: "fit", contains: "padding" },
          config: { ...VEGA_CONFIG, ...userConfig },
        };
        const result = await vegaEmbed(ref.current, themed as unknown as import("vega-embed").VisualizationSpec, {
          actions: false,
          renderer: "svg",
        });
        if (cancelled) { result.finalize(); return; }
        finalize = result.finalize;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "render-failed");
      }
    })();

    return () => { cancelled = true; if (finalize) finalize(); };
  }, [spec, blocked]);

  if (blocked || error) {
    return (
      <p className="px-4 py-4 text-[12px] text-muted-foreground">
        {fallback ?? "This chart could not be rendered. The analysis is in the surrounding text."}
      </p>
    );
  }
  return <div ref={ref} className="w-full px-2 py-3 [&_.vega-embed]:w-full [&_svg]:h-auto! [&_svg]:max-w-full!" />;
}
