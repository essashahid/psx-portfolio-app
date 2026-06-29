/**
 * Artifact types and streaming extractor for the Research Copilot.
 *
 * The model embeds artifact specs as fenced ```artifact blocks in its text
 * output. The extractor intercepts the raw delta stream, strips those blocks,
 * emits them as typed ArtifactSpec objects, and lets clean prose through.
 */

// ── Artifact kind union ──────────────────────────────────────────────────────

export interface PriceChartArtifact {
  kind: "price-chart";
  title: string;
  ticker: string;
  /** "1M" | "3M" | "6M" | "1Y" | "2Y" | "3Y" */
  period: string;
  /** Which overlays to draw on the chart */
  overlay?: Array<"cost-basis" | "dividends" | "transactions" | "volume">;
  description?: string;
  fallback?: string;
}

export interface BarChartSeries {
  key: string;
  label: string;
  color?: string;
}

export interface BarChartArtifact {
  kind: "bar-chart";
  title: string;
  description?: string;
  /** The row property used for the x-axis category label */
  xKey: string;
  bars: BarChartSeries[];
  data: Record<string, string | number>[];
  yUnit?: string;
  fallback?: string;
}

export interface ComparisonTableArtifact {
  kind: "comparison-table";
  title: string;
  description?: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  fallback?: string;
}

export interface MetricItem {
  label: string;
  value: string;
  delta?: string;
  tone?: "positive" | "negative" | "neutral";
  detail?: string;
}

export interface MetricStripArtifact {
  kind: "metric-strip";
  title?: string;
  metrics: MetricItem[];
}

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  format?: "text" | "number" | "currency" | "percent" | "date";
}

export interface TableArtifact {
  kind: "table";
  title: string;
  description?: string;
  columns: TableColumn[];
  rows: Record<string, string | number | null>[];
  fallback?: string;
}

export interface TimelineEvent {
  date: string;
  label: string;
  type: "filing" | "dividend" | "earnings" | "news" | "transaction" | "corporate" | "other";
  detail?: string;
  value?: string;
}

export interface TimelineArtifact {
  kind: "timeline";
  title: string;
  description?: string;
  events: TimelineEvent[];
  fallback?: string;
}

export interface AttributionItem {
  label: string;
  value: number;
  percent?: number;
  tone?: "positive" | "negative" | "neutral";
}

export interface PortfolioAttributionArtifact {
  kind: "portfolio-attribution";
  title: string;
  description?: string;
  items: AttributionItem[];
  fallback?: string;
}

export interface ArtifactErrorSpec {
  kind: "error";
  title: string;
  message: string;
}

export type ArtifactSpec =
  | PriceChartArtifact
  | BarChartArtifact
  | ComparisonTableArtifact
  | MetricStripArtifact
  | TableArtifact
  | TimelineArtifact
  | PortfolioAttributionArtifact
  | ArtifactErrorSpec;

// ── Streaming extractor ──────────────────────────────────────────────────────

const OPEN_MARKER = "```artifact";
const CLOSE_MARKER = "```";

/**
 * Intercepts the raw delta stream from the model, extracts ```artifact blocks,
 * and routes them separately from clean prose.
 *
 * Usage:
 *   const ex = new ArtifactExtractor(
 *     (delta) => send({ type: "text", delta }),
 *     (spec)  => send({ type: "artifact", spec })
 *   );
 *   mstream.on("text", (d) => ex.push(d));
 *   // After each turn:
 *   ex.flush();
 */
export class ArtifactExtractor {
  private buf = "";
  private inArtifact = false;
  private artifactBuf = "";

  constructor(
    private readonly onText: (delta: string) => void,
    private readonly onArtifact: (spec: ArtifactSpec) => void
  ) {}

  push(delta: string) {
    this.buf += delta;
    this.drain();
  }

  /** Call once at the end of a streaming turn to flush any pending plain text. */
  flush() {
    if (this.inArtifact) {
      // Unterminated block — treat it as prose (shouldn't happen in practice).
      this.onText("```artifact\n" + this.artifactBuf);
      this.inArtifact = false;
      this.artifactBuf = "";
    }
    if (this.buf) {
      this.onText(this.buf);
      this.buf = "";
    }
  }

  /** Reset state between tool turns so narration from one turn doesn't bleed. */
  reset() {
    this.buf = "";
    this.inArtifact = false;
    this.artifactBuf = "";
  }

  private drain() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!this.inArtifact) {
        const openIdx = this.buf.indexOf(OPEN_MARKER);
        if (openIdx === -1) {
          // No opening found. Safe to emit everything except the last N chars
          // that might be the start of "```artifact".
          const safeLen = Math.max(0, this.buf.length - OPEN_MARKER.length);
          if (safeLen > 0) {
            this.onText(this.buf.slice(0, safeLen));
            this.buf = this.buf.slice(safeLen);
          }
          break;
        }
        // Emit text before the opening marker.
        if (openIdx > 0) this.onText(this.buf.slice(0, openIdx));
        // Advance past "```artifact" and wait for the newline.
        const afterOpen = this.buf.slice(openIdx + OPEN_MARKER.length);
        const nlIdx = afterOpen.indexOf("\n");
        if (nlIdx === -1) {
          // Incomplete opening — keep buffering.
          this.buf = this.buf.slice(openIdx);
          break;
        }
        this.buf = afterOpen.slice(nlIdx + 1);
        this.inArtifact = true;
        this.artifactBuf = "";
      } else {
        const closeIdx = this.buf.indexOf(CLOSE_MARKER);
        if (closeIdx === -1) {
          // Accumulate artifact body, keep last 3 chars buffered (partial ```).
          const safeLen = Math.max(0, this.buf.length - CLOSE_MARKER.length);
          this.artifactBuf += this.buf.slice(0, safeLen);
          this.buf = this.buf.slice(safeLen);
          break;
        }
        this.artifactBuf += this.buf.slice(0, closeIdx);
        this.buf = this.buf.slice(closeIdx + CLOSE_MARKER.length);
        if (this.buf.startsWith("\n")) this.buf = this.buf.slice(1);
        this.inArtifact = false;

        try {
          const raw = this.artifactBuf.trim();
          const spec = JSON.parse(raw) as ArtifactSpec;
          if (spec && typeof spec.kind === "string") this.onArtifact(spec);
        } catch {
          // Attempt partial JSON recovery: close unclosed braces/brackets.
          const recovered = tryRecoverJson(this.artifactBuf.trim());
          if (recovered && typeof recovered.kind === "string") {
            this.onArtifact(recovered as unknown as ArtifactSpec);
          } else {
            // Emit as error artifact so nothing silently disappears.
            this.onArtifact({
              kind: "error",
              title: "Rendering failed",
              message: "This artifact could not be rendered. The underlying analysis is in the surrounding text.",
            });
          }
        }
        this.artifactBuf = "";
      }
    }
  }
}

/**
 * Attempt to recover truncated JSON by closing unclosed braces and brackets.
 * Returns the parsed object if successful, null otherwise.
 */
function tryRecoverJson(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  let attempt = raw;
  // Count unclosed brackets/braces.
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;
  for (const ch of attempt) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  // Close any open strings/brackets/braces.
  if (inString) attempt += '"';
  while (brackets > 0) { attempt += "]"; brackets--; }
  while (braces > 0) { attempt += "}"; braces--; }
  try {
    return JSON.parse(attempt) as Record<string, unknown>;
  } catch {
    return null;
  }
}
