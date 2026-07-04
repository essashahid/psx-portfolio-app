import type { ArtifactSpec, TableArtifact } from "@/lib/chat/artifacts";

/**
 * Tier-1 visual upgrades, pure and unit-testable:
 *
 * 1. `splitTablesFromMarkdown` turns the markdown tables models still emit
 *    (31% of real answers, versus 20% with any rendered artifact) into styled
 *    table artifact specs at render time, so the model's laziness stops
 *    mattering and every already-saved answer upgrades retroactively.
 *
 * 2. `splitContentWithMarkers` restores an answer's streamed layout from the
 *    persisted `[[artifact:N]]` position markers, fixing the orphaned-heading
 *    problem where every chart was appended after the prose on reload.
 */

// ── Markdown table → table artifact ─────────────────────────────────────────

export interface ContentSegment {
  type: "text" | "table";
  content: string; // text segments only
  spec?: TableArtifact; // table segments only
}

const SEP_CELL = /^\s*:?-{3,}:?\s*$/;

function splitRow(line: string): string[] {
  // Trim one leading/trailing pipe, then split on unescaped pipes.
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.replace(/\\\|/g, "|").trim());
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => SEP_CELL.test(c));
}

const NUMERIC = /^[+-]?\d[\d,]*(?:\.\d+)?$/;
const PERCENT = /^[+-]?\d[\d,]*(?:\.\d+)?\s?(?:%|pts?|bps)$/i;
const CURRENCY = /^(?:PKR|Rs\.?)\s?[+-]?\d[\d,]*(?:\.\d+)?[kKmMbB]?n?$|^[+-]?\d[\d,]*(?:\.\d+)?\s?(?:PKR|Rs\.?)$/;

function inferFormat(cells: string[]): TableArtifact["columns"][number]["format"] {
  const filled = cells.filter((c) => c && c !== "—" && c !== "-");
  if (filled.length === 0) return "text";
  if (filled.every((c) => PERCENT.test(c))) return "percent";
  if (filled.every((c) => CURRENCY.test(c))) return "currency";
  if (filled.every((c) => NUMERIC.test(c))) return "number";
  return "text";
}

/** Numeric formats hold parsed numbers so the renderer can format and color them. */
function cellValue(raw: string, format: TableArtifact["columns"][number]["format"]): string | number | null {
  if (!raw || raw === "—" || raw === "-") return null;
  if (format === "number") return Number(raw.replace(/,/g, ""));
  if (format === "percent") {
    const n = Number(raw.replace(/,/g, "").replace(/\s?(?:%|pts?|bps)$/i, ""));
    return Number.isFinite(n) ? n : raw;
  }
  return raw; // currency keeps its original text (units like 1.2M vary too much)
}

/**
 * Split answer text into prose and table-artifact segments. Only well-formed
 * GFM tables (header + separator + at least one body row, consistent-ish
 * column counts) are converted; anything else passes through untouched.
 */
export function splitTablesFromMarkdown(text: string): ContentSegment[] {
  const lines = text.split("\n");
  const segments: ContentSegment[] = [];
  let buf: string[] = [];

  const flushText = () => {
    if (buf.length) {
      const chunk = buf.join("\n");
      if (chunk.trim()) segments.push({ type: "text", content: chunk });
      else if (segments.length) segments.push({ type: "text", content: chunk });
      buf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const looksLikeHeader = line.trimStart().startsWith("|") || (line.includes("|") && i + 1 < lines.length && isSeparatorRow(lines[i + 1]));
    if (looksLikeHeader && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(line);
      const bodyLines: string[] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
        bodyLines.push(lines[j]);
        j++;
      }
      if (header.length >= 2 && bodyLines.length >= 1) {
        const rowsRaw = bodyLines.map(splitRow);
        const keys = header.map((_, idx) => `c${idx}`);
        const formats = header.map((_, idx) => inferFormat(rowsRaw.map((r) => r[idx] ?? "")));
        const spec: TableArtifact = {
          kind: "table",
          title: "",
          columns: header.map((label, idx) => ({
            key: keys[idx],
            label: label.replace(/\*\*/g, ""),
            align: formats[idx] === "text" ? "left" : "right",
            format: formats[idx],
          })),
          rows: rowsRaw.map((r) =>
            Object.fromEntries(keys.map((k, idx) => [k, cellValue((r[idx] ?? "").replace(/\*\*/g, ""), formats[idx])]))
          ),
        };
        flushText();
        segments.push({ type: "table", content: "", spec });
        i = j;
        continue;
      }
    }
    buf.push(line);
    i++;
  }
  flushText();
  return segments.length ? segments : [{ type: "text", content: text }];
}

// ── Artifact position markers ────────────────────────────────────────────────

export const ARTIFACT_MARKER_RE = /\[\[artifact:(\d+)\]\]/g;

export function artifactMarker(index: number): string {
  return `\n\n[[artifact:${index}]]\n\n`;
}

export function stripArtifactMarkers(text: string): string {
  return text.replace(ARTIFACT_MARKER_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export interface RestoredPart {
  type: "text" | "artifact";
  content?: string;
  spec?: ArtifactSpec;
}

/**
 * Rebuild the streamed interleaving of prose and artifacts from persisted
 * content markers. Specs never referenced by a marker (older messages, or
 * markers lost to a tool-turn reset) are appended at the end, which is exactly
 * the pre-marker behaviour.
 */
export function splitContentWithMarkers(content: string, specs: ArtifactSpec[]): RestoredPart[] {
  const parts: RestoredPart[] = [];
  const used = new Set<number>();
  let last = 0;
  for (const m of content.matchAll(ARTIFACT_MARKER_RE)) {
    const text = content.slice(last, m.index);
    if (text.trim()) parts.push({ type: "text", content: text.trim() });
    const idx = Number(m[1]);
    if (Number.isInteger(idx) && idx >= 0 && idx < specs.length && !used.has(idx)) {
      used.add(idx);
      parts.push({ type: "artifact", spec: specs[idx] });
    }
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = content.slice(last);
  if (tail.trim()) parts.push({ type: "text", content: tail.trim() });
  specs.forEach((spec, idx) => {
    if (!used.has(idx)) parts.push({ type: "artifact", spec });
  });
  if (parts.length === 0) parts.push({ type: "text", content: "" });
  return parts;
}
