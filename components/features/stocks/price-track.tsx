import { formatNumber } from "@/lib/shared/format";

/**
 * The 60-session price track that sits in the company header.
 *
 * The y-axis is scaled to the 52-week range rather than to the series own
 * min and max. That is the whole point of the two dashed rails: a line that
 * always filled the box would say nothing about where the price sits in its
 * year, and every company would look equally extended. Scaled this way, a
 * stock near its high rides the top rail and one that has sold off sits low in
 * the frame, readable before any number is.
 *
 * Rendered server-side as plain SVG: it is a static picture of closed
 * sessions, so there is nothing to hydrate.
 */
export function PriceTrack({
  closes,
  low52,
  high52,
  hue,
}: {
  closes: number[];
  low52: number | null;
  high52: number | null;
  hue: string;
}) {
  const W = 460;
  const H = 104;
  const PAD = 4;

  const usable = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (usable.length < 2 || low52 === null || high52 === null || high52 <= low52) {
    return (
      <p className="text-(length:--text-2xs) text-text-faint">
        Not enough price history to draw the track.
      </p>
    );
  }

  // Rails sit PAD from each edge, so the plotted band is the 52-week range.
  // Clamped because the two come from different sources: if the 52-week bounds
  // lag a close that has just broken out, an unclamped point would be drawn
  // outside the frame rather than sitting on the rail it just passed.
  const y = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - low52) / (high52 - low52)));
    return H - PAD - t * (H - PAD * 2);
  };
  const x = (i: number) => (i / (usable.length - 1)) * W;

  const pts = usable.map((c, i) => `${x(i).toFixed(1)} ${y(c).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = usable[usable.length - 1];
  const pctOfRange = Math.round(((last - low52) / (high52 - low52)) * 100);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-(length:--text-3xs) font-bold uppercase tracking-(--tracking-caps) text-text-faint">
          Last {usable.length} sessions
        </span>
        <span className="figure text-(length:--text-2xs) text-text-faint">high {formatNumber(high52)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        className="block overflow-visible"
        aria-hidden="true"
      >
        <line x1="0" y1={PAD} x2={W} y2={PAD} stroke="var(--rule-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1={H - PAD} x2={W} y2={H - PAD} stroke="var(--rule-strong)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <path d={area} fill={hue} fillOpacity="0.12" />
        <path
          d={line}
          fill="none"
          stroke={hue}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={W} cy={y(last)} r="3.5" fill={hue} />
      </svg>
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <span className="text-(length:--text-2xs) text-text-faint">
          Dashed rails are the 52-week high and low · {pctOfRange}% of range
        </span>
        <span className="figure text-(length:--text-2xs) text-text-faint">low {formatNumber(low52)}</span>
      </div>
    </div>
  );
}
