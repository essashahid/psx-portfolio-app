/**
 * Backstop for the case where a model emits a function call as plain text
 * instead of a structured tool call. DeepSeek R1 (Reasoner) doesn't support
 * function calling, so if it is ever handed tools it "writes out" the call
 * using its internal markup (e.g. `<｜tool calls｜>`, `DSML`, `invoke name=`).
 *
 * A genuine answer never contains these tokens, so detection can be aggressive:
 * if any appear, we treat the whole message as a failed turn and replace it.
 */

const LEAK_RE = /\bDSML\b|tool[_▁\s]*calls?|<\s*[｜|]|invoke\s+name=|parameter\s+name=/i;

export function looksLikeToolLeak(text: string): boolean {
  return !!text && LEAK_RE.test(text);
}

export const TOOL_LEAK_FALLBACK =
  "I couldn't complete that lookup cleanly with this model. The DeepSeek Reasoner can't run live web or data lookups, so for “why did it move” questions use DeepSeek Chat or a Claude model instead.";

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
