/**
 * The app mark: an aperture with a plumb line dropping through it.
 *
 * Stroke thickens as the mark shrinks, and the bob is dropped at and below
 * 16px where it would close the line into a blob. That is why this takes a
 * size and picks its own geometry rather than exposing a scalable 64px path:
 * scaling one drawing down is precisely the failure this prevents.
 *
 * The aperture is currentColor so it inherits the surrounding text colour. The
 * line is the only coloured part and is always indigo — --indigo-2 on paper,
 * --indigo-3 on navy so it clears the darker field.
 */

type Tone = "paper" | "navy" | "mono";

type Tier = { stroke: number; inset: number; bob: boolean };

/** From the size table in the brand brief. */
function tierFor(size: number): Tier {
  if (size >= 48) return { stroke: 3.55, inset: 14, bob: true };
  if (size >= 28) return { stroke: 4.4, inset: 14, bob: true };
  if (size >= 17) return { stroke: 5.6, inset: 13, bob: true };
  return { stroke: 7.5, inset: 12, bob: false };
}

export function PlumbMark({
  size = 19,
  tone = "paper",
  className,
}: {
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  const { stroke, inset, bob } = tierFor(size);

  // The aperture sits inset from a 64 unit box, so its side shrinks as the
  // inset grows and the stroke stays centred on the same frame.
  const side = 64 - inset * 2;
  // The line runs the full height at large sizes and pulls in as the stroke
  // thickens, so the cap never overhangs the box it hangs from.
  const lineTop = Math.max(2, inset - 10);
  const lineBottom = 64 - lineTop;

  const aperture = tone === "navy" ? "rgba(255,255,255,0.92)" : "currentColor";
  const line = tone === "mono" ? "currentColor" : tone === "navy" ? "var(--indigo-3)" : "var(--indigo-2)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="PortfolioOS PK"
      className={className}
    >
      <rect
        x={inset}
        y={inset}
        width={side}
        height={side}
        fill="none"
        stroke={aperture}
        strokeWidth={stroke}
      />
      <path d={`M32 ${lineTop} V${lineBottom}`} stroke={line} strokeWidth={stroke} />
      {bob ? <circle cx={32} cy={lineBottom} r={stroke * 1.02} fill={line} /> : null}
    </svg>
  );
}
