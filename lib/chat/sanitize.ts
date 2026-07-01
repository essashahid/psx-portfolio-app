/**
 * Backstop for the case where a model emits a function call as plain text
 * instead of a structured tool call. Some providers occasionally "write out"
 * internal call markup (e.g. `<｜tool calls｜>`, `DSML`, `invoke name=`).
 *
 * Keep this narrow: normal prose may mention tools, but a genuine answer should
 * never contain provider markup or invocation syntax.
 */

const LEAK_RE = /\bDSML\b|<\s*[｜|][^>]*(tool|function)|invoke\s+name=|parameter\s+name=/i;

export function looksLikeToolLeak(text: string): boolean {
  return !!text && LEAK_RE.test(text);
}

/**
 * Enforce the house rule that answers never use em or en dashes. The owner
 * dislikes them and models (DeepSeek Flash especially) ignore the prompt
 * instruction, so we strip them deterministically as part of the pipeline: a
 * dash between digits becomes a "to" range, any other dash becomes a comma. Only
 * targets — (U+2014) and – (U+2013), so hyphens like "KSE-100" and "52-week" are
 * untouched. Applied both to the live output stream and inside the eval, so the
 * eval scores what actually ships.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}
