/**
 * Tiny inline-SVG sparkline — no chart library, so hundreds can render on the
 * screener without jank. Colours by net direction (last vs first close) with a
 * soft gradient area fill. Server-renderable (pure, no client JS).
 */
export function Sparkline({
  data,
  width = 72,
  height = 24,
  className,
}: {
  data: number[] | null | undefined;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={className} aria-hidden />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const usableH = height - pad * 2;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - ((v - min) / range) * usableH;
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? "#0b8a5c" : "#cf3a3a";
  const fillId = `sl-${up ? "u" : "d"}`;
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
